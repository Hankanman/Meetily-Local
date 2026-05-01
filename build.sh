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
#   target/release/bundle/deb/meetily_<ver>_amd64.deb

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

        # linuxdeploy's bundled `strip` chokes on SHT_RELR sections in modern Fedora libs.
        export NO_STRIP="${NO_STRIP:-1}"
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
SCRIPT="tauri:build"
case "$MODE" in
    cuda)   SCRIPT="tauri:build:cuda" ;;
    vulkan) SCRIPT="tauri:build:vulkan" ;;
    cpu)    SCRIPT="tauri:build:cpu" ;;
esac

echo "==> Running pnpm run $SCRIPT"
# Tauri exits 1 on the post-bundle TAURI_SIGNING_PRIVATE_KEY warning even when
# bundles succeeded — verify by artifact existence rather than exit code.
set +e
pnpm run "$SCRIPT"
BUILD_RC=$?
set -e

# ----- post-flight: locate artifacts -----
APPIMAGE=$(ls -t "$ROOT"/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1)
DEB=$(ls -t "$ROOT"/target/release/bundle/deb/*.deb 2>/dev/null | head -1)

if [[ -n "$APPIMAGE" || -n "$DEB" ]]; then
    echo
    echo "==> Build succeeded"
    [[ -n "$APPIMAGE" ]] && echo "    AppImage: $APPIMAGE ($(du -h "$APPIMAGE" | cut -f1))"
    [[ -n "$DEB" ]]      && echo "    .deb:     $DEB ($(du -h "$DEB" | cut -f1))"
    exit 0
else
    echo
    echo "==> Build FAILED (no artifacts found, tauri exit code $BUILD_RC)" >&2
    exit "$BUILD_RC"
fi
