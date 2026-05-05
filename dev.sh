#!/usr/bin/env bash
# Meetily — dev launcher (Linux focus)
#
# Usage:
#   ./dev.sh              # auto: full Tauri dev with CUDA on NVIDIA, CPU otherwise
#   ./dev.sh cuda         # full Tauri dev, NVIDIA CUDA
#   ./dev.sh vulkan       # full Tauri dev, AMD/Intel Vulkan
#   ./dev.sh cpu          # full Tauri dev, CPU-only
#   ./dev.sh frontend     # frontend-only (next dev), no Tauri shell — fastest UI loop
#   ./dev.sh --help
#
# Environment overrides (pre-set if you know better):
#   CUDAHOSTCXX         host C++ compiler for nvcc (default: auto-detect g++-15 on Fedora)
#   CUDAARCHS           CUDA arch list (default: "75;80;86;89;90" — Turing→Hopper)
#
# What you get with full Tauri dev:
#   - Rust debug build (~2-3 min first time, ~10-30s incremental)
#   - Next.js dev server on :3118 with Turbopack HMR
#   - Native Tauri window pointed at the dev server
#   - Hot reload on both sides
#
# Frontend-only mode is best for pure UI work. Tauri `invoke()` calls fail
# because there's no Tauri shell, but UI changes update instantly in your
# regular browser at http://localhost:3118.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$ROOT/$(basename "${BASH_SOURCE[0]}")"

MODE="${1:-auto}"
case "$MODE" in
    --help|-h)
        sed -n '2,22p' "$SELF" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
    auto)
        if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
            MODE=cuda
        else
            MODE=cpu
        fi
        ;;
    cuda|vulkan|cpu|frontend) ;;
    *)
        echo "error: unknown mode '$MODE' (expected: cuda, vulkan, cpu, frontend, auto)" >&2
        exit 2
        ;;
esac

echo "==> Dev mode: $MODE"
cd "$ROOT/frontend"

# Full Rust backtrace on panic. Note: glibc's abort() from
# `free(): invalid pointer` bypasses Rust's panic handler, so this won't
# show a Rust trace for that specific kind of crash — use gdb if needed.
export RUST_BACKTRACE="${RUST_BACKTRACE:-full}"

# Default log filter:
#   - app_lib at info  → our own logs visible
#   - whisper_rs at warn → drop the per-decoder beam-search trace noise
#                          (whisper.cpp emits these at INFO, very chatty)
#   - everything else at info
# Override by exporting RUST_LOG before invoking dev.sh.
export RUST_LOG="${RUST_LOG:-info,whisper_rs=warn}"

# sherpa-onnx is linked dynamically (via the `shared` Cargo feature) to
# avoid the static-onnxruntime conflict with whisper-rs. The build script
# drops libsherpa-onnx-c-api.so / libonnxruntime.so into target/debug/
# but doesn't set an rpath, so the loader needs to be told where to look.
# Production builds will need this baked into the bundle's library dir.
SHERPA_LIB_DIR="$ROOT/target/debug"
if [[ -d "$SHERPA_LIB_DIR" ]]; then
    if [[ -n "${LD_LIBRARY_PATH:-}" ]]; then
        export LD_LIBRARY_PATH="$SHERPA_LIB_DIR:$LD_LIBRARY_PATH"
    else
        export LD_LIBRARY_PATH="$SHERPA_LIB_DIR"
    fi
fi

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

# ----- frontend-only fast path -----
if [[ "$MODE" == "frontend" ]]; then
    echo "==> Running pnpm dev (Next.js Turbopack on :3118)"
    echo "    Tauri APIs (invoke / events) will not work in this mode."
    exec pnpm dev
fi

# ----- Tauri dev: env-var setup for Linux + CUDA -----
case "$(uname -s)" in
    Linux)
        # Fedora 44 ships gcc 16; CUDA 13.2's nvcc only supports gcc ≤ 15.
        if [[ "$MODE" == "cuda" && -z "${CUDAHOSTCXX:-}" ]]; then
            if [[ -x /usr/bin/g++-15 ]]; then
                export CUDAHOSTCXX=/usr/bin/g++-15
                echo "==> CUDAHOSTCXX=/usr/bin/g++-15 (Fedora gcc-16 workaround)"
            elif [[ -x /usr/bin/g++-14 ]]; then
                export CUDAHOSTCXX=/usr/bin/g++-14
                echo "==> CUDAHOSTCXX=/usr/bin/g++-14"
            fi
        fi
        # Dev defaults to a single GPU arch — much faster nvcc compile than
        # the multi-arch list build.sh uses for portable binaries.
        # Override with `CUDAARCHS=...` if you have a different GPU than 8.6.
        # Detect compute capability via nvidia-smi if available, fall back to 86.
        if [[ "$MODE" == "cuda" && -z "${CUDAARCHS:-}" ]]; then
            CC=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | head -1 | tr -d '.')
            : "${CC:=86}"
            export CUDAARCHS="${CC}-real"
            echo "==> CUDAARCHS=$CUDAARCHS (single-arch dev build)"
        fi
        ;;
esac

# ----- run tauri dev -----
SCRIPT="tauri:dev"
case "$MODE" in
    cuda)   SCRIPT="tauri:dev:cuda" ;;
    vulkan) SCRIPT="tauri:dev:vulkan" ;;
    cpu)    SCRIPT="tauri:dev:cpu" ;;
esac

echo "==> Running pnpm $SCRIPT"
echo "    Frontend HMR: http://localhost:3118"
echo "    Press Ctrl+C to stop both Rust and Next.js processes."
exec pnpm run "$SCRIPT"
