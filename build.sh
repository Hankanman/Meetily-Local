#!/usr/bin/env bash
# Meetily — all-in-one build script (Linux focus)
#
# Usage:
#   ./build.sh              # default: cuda on Linux with NVIDIA, cpu otherwise
#   ./build.sh cuda         # NVIDIA CUDA
#   ./build.sh vulkan       # AMD/Intel Vulkan
#   ./build.sh cpu          # CPU-only
#   ./build.sh --help
#
# Environment overrides (pre-set if you know better):
#   CUDAHOSTCXX         host C++ compiler nvcc should use (default: auto-detect g++-15 on Fedora)
#   CUDAARCHS           CUDA arch list (default: "75;80;86;89;90" — Turing→Hopper)
#   NO_STRIP            keep set to 1 on Fedora 43+ (linuxdeploy SHT_RELR incompatibility)
#
# Produces:
#   target/release/bundle/appimage/meetily_<ver>_amd64.AppImage
#
# (The .deb target is intentionally skipped — it doesn't bundle
# libsherpa-onnx-c-api.so so the resulting package wouldn't run on a clean
# host. Use the AppImage, which embeds all native libs via linuxdeploy.)

set -euo pipefail

# ----- repo root anchor -----
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$ROOT/$(basename "${BASH_SOURCE[0]}")"

# ----- arg parsing -----
MODE="${1:-auto}"
case "$MODE" in
    --help|-h)
        sed -n '2,18p' "$SELF" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
    auto)
        if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
            MODE=cuda
        else
            MODE=cpu
        fi
        ;;
    cuda|vulkan|cpu) ;;
    *)
        echo "error: unknown mode '$MODE' (expected: cuda, vulkan, cpu, auto)" >&2
        exit 2
        ;;
esac

echo "==> Build mode: $MODE"
cd "$ROOT/frontend"

# ----- platform-specific env -----
case "$(uname -s)" in
    Linux)
        # Fedora 44 ships gcc 16; CUDA 13.2's nvcc only supports gcc ≤ 15.
        # Auto-detect g++-15 if not overridden.
        if [[ "$MODE" == "cuda" && -z "${CUDAHOSTCXX:-}" ]]; then
            if [[ -x /usr/bin/g++-15 ]]; then
                export CUDAHOSTCXX=/usr/bin/g++-15
                echo "==> CUDAHOSTCXX=/usr/bin/g++-15 (Fedora gcc-16 workaround)"
            elif [[ -x /usr/bin/g++-14 ]]; then
                export CUDAHOSTCXX=/usr/bin/g++-14
                echo "==> CUDAHOSTCXX=/usr/bin/g++-14"
            fi
        fi

        # CUDA 13 dropped sm_52 (Maxwell). Pin to Turing+ unless overridden.
        if [[ "$MODE" == "cuda" && -z "${CUDAARCHS:-}" ]]; then
            export CUDAARCHS="75;80;86;89;90"
            echo "==> CUDAARCHS=$CUDAARCHS"
        fi

        # rust-lld on modern Rust requires every input to be PIE-relocatable.
        # llama-cpp-sys-2's CUDA .cu.o files default to non-PIC, which triggers
        # `R_X86_64_32 cannot be used against local symbol; recompile with -fPIC`
        # when linking the llama-helper binary.
        export CMAKE_POSITION_INDEPENDENT_CODE="${CMAKE_POSITION_INDEPENDENT_CODE:-ON}"

        # linuxdeploy's bundled `strip` chokes on SHT_RELR sections in modern Fedora libs.
        export NO_STRIP="${NO_STRIP:-1}"

        # sherpa-onnx-sys drops `libsherpa-onnx-c-api.so` into target/release/ but
        # leaves the meetily binary without a RUNPATH, so linuxdeploy fails with
        # `Could not find dependency: libsherpa-onnx-c-api.so`. Point its
        # dependency-resolver at the cargo output dir so it can bundle the lib.
        export LD_LIBRARY_PATH="$ROOT/target/release${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        ;;
    Darwin)
        # macOS Metal/CoreML auto-enabled by whisper-rs feature flags
        : ;;
    *)
        echo "warning: unsupported uname '$(uname -s)'; proceeding anyway" >&2
        ;;
esac

# ----- compiler-cache opt-in (auto-enables if sccache is installed) -----
if command -v sccache >/dev/null 2>&1; then
    export RUSTC_WRAPPER="${RUSTC_WRAPPER:-sccache}"
    export CMAKE_C_COMPILER_LAUNCHER="${CMAKE_C_COMPILER_LAUNCHER:-sccache}"
    export CMAKE_CXX_COMPILER_LAUNCHER="${CMAKE_CXX_COMPILER_LAUNCHER:-sccache}"
    export CMAKE_CUDA_COMPILER_LAUNCHER="${CMAKE_CUDA_COMPILER_LAUNCHER:-sccache}"
    echo "==> sccache enabled (cached compiles for Rust + C/C++ + CUDA)"
fi

# ----- pre-flight -----
if ! command -v pnpm >/dev/null 2>&1; then
    echo "error: pnpm not found (install via 'npm i -g pnpm' or 'corepack enable')" >&2
    exit 1
fi

if [[ ! -d node_modules ]]; then
    echo "==> Installing JS deps"
    pnpm install --frozen-lockfile
fi

# ----- build -----
# Feature flag matches the tauri:build:* npm scripts, but we drop the npm-script
# layer so we can pass `--bundles appimage` to tauri without touching
# tauri.conf.json (which still needs deb/msi/dmg for other platforms).
TAURI_FEATURES=()
case "$MODE" in
    cuda)   TAURI_FEATURES=(--features cuda) ;;
    vulkan) TAURI_FEATURES=(--features vulkan) ;;
    cpu)    ;;
esac

# ----- llama-helper sidecar -----
# Tauri's externalBin expects binaries/llama-helper-<target-triple>; build it
# with the same GPU backend as the main app.
TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
HELPER_BIN_NAME="llama-helper"
HELPER_SIDECAR_NAME="llama-helper-${TARGET_TRIPLE}"
if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* ]]; then
    HELPER_BIN_NAME="llama-helper.exe"
    HELPER_SIDECAR_NAME="llama-helper-${TARGET_TRIPLE}.exe"
fi

HELPER_FEATURES=()
case "$MODE" in
    cuda)   HELPER_FEATURES=(--features cuda) ;;
    vulkan) HELPER_FEATURES=(--features vulkan) ;;
    cpu)    ;;  # no GPU feature
esac

echo "==> Building llama-helper sidecar (${MODE})"
( cd "$ROOT/llama-helper" && cargo build --release "${HELPER_FEATURES[@]}" )

HELPER_SRC="$ROOT/target/release/$HELPER_BIN_NAME"
HELPER_DEST_DIR="$ROOT/frontend/src-tauri/binaries"
HELPER_DEST="$HELPER_DEST_DIR/$HELPER_SIDECAR_NAME"
mkdir -p "$HELPER_DEST_DIR"
find "$HELPER_DEST_DIR" -maxdepth 1 -name 'llama-helper-*' -delete
cp "$HELPER_SRC" "$HELPER_DEST"
echo "==> Staged sidecar: $HELPER_DEST"

echo "==> Running tauri build --bundles appimage (${MODE})"
# Tauri exits 1 on the post-bundle TAURI_SIGNING_PRIVATE_KEY warning even when
# bundles succeeded — verify by artifact existence rather than exit code.
# `--` separates tauri-cli flags from cargo flags; only emit it when we have
# cargo features to pass, otherwise tauri sees a bare `--` and parses oddly.
set +e
if (( ${#TAURI_FEATURES[@]} )); then
    pnpm exec tauri build --bundles appimage -- "${TAURI_FEATURES[@]}"
else
    pnpm exec tauri build --bundles appimage
fi
BUILD_RC=$?
set -e

# ----- post-flight: locate artifacts -----
# `set -o pipefail` makes the ls-glob-then-head idiom abort the script when no
# match exists, so use find — which simply emits zero lines without failing.
APPIMAGE=$(find "$ROOT/target/release/bundle/appimage" -maxdepth 1 -name '*.AppImage' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)

if [[ -n "$APPIMAGE" ]]; then
    echo
    echo "==> Build succeeded"
    echo "    AppImage: $APPIMAGE ($(du -h "$APPIMAGE" | cut -f1))"
    exit 0
else
    echo
    echo "==> Build FAILED (no AppImage found, tauri exit code $BUILD_RC)" >&2
    exit "$BUILD_RC"
fi
