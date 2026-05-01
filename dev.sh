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
        # CUDA 13 dropped sm_52 (Maxwell). Pin to Turing+ unless overridden.
        if [[ "$MODE" == "cuda" && -z "${CUDAARCHS:-}" ]]; then
            export CUDAARCHS="75;80;86;89;90"
            echo "==> CUDAARCHS=$CUDAARCHS"
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
