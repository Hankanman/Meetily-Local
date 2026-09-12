#!/usr/bin/env bash
# Meetily — dev launcher (Linux focus)
#
# Usage:
#   ./dev.sh              # auto: full Tauri dev with CUDA on NVIDIA, CPU otherwise
#   ./dev.sh cuda         # full Tauri dev, NVIDIA CUDA
#   ./dev.sh vulkan       # full Tauri dev, AMD/Intel Vulkan
#   ./dev.sh cpu          # full Tauri dev, CPU-only
#   ./dev.sh frontend     # frontend-only (next dev), no Tauri shell — fastest UI loop
#   ./dev.sh gpui [cuda|vulkan|cpu]   # GPUI shell (meetily-gpui), no Next.js/pnpm
#                                      # mode defaults to auto (same GPU detection)
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
#
# GPUI mode builds and runs the `meetily-gpui` binary directly via
# `cargo run` — no webview, no Next.js/pnpm involved. Work in progress.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$ROOT/$(basename "${BASH_SOURCE[0]}")"

# ----- shared helpers -----

# Sets RUST_BACKTRACE / RUST_LOG defaults and opts into sccache if installed.
setup_common_env() {
    # Full Rust backtrace on panic. Note: glibc's abort() from
    # `free(): invalid pointer` bypasses Rust's panic handler, so this won't
    # show a Rust trace for that specific kind of crash — use gdb if needed.
    export RUST_BACKTRACE="${RUST_BACKTRACE:-full}"

    # Default log filter:
    #   - app_lib at info  → our own logs visible
    #   - whisper_rs at warn → drop the per-decoder beam-search trace noise
    #                          (whisper.cpp emits these at INFO, very chatty)
    #   - zbus / tracing / wgpu / naga at warn → D-Bus (tray, portals) and
    #                          GPU-backend chatter the GPUI shell would
    #                          otherwise log at INFO on every tray poll
    #   - wgpu_hal::vulkan::instance at error → the Vulkan loader warns once
    #                          per incompatible ICD it skips (e.g. Mesa's
    #                          dzn/D3D12 shim on a normal Linux box), which
    #                          is expected and not actionable
    #   - gpui_component::theme::mono_font at error → gpui-kit warns when its
    #                          hard-coded default mono font is missing, from
    #                          inside its own init; we replace the family with
    #                          the desktop's a moment later (see fonts.rs)
    #   - everything else at info
    # Override by exporting RUST_LOG before invoking dev.sh.
    export RUST_LOG="${RUST_LOG:-info,whisper_rs=warn,zbus=warn,tracing=warn,wgpu_hal=warn,wgpu_core=warn,naga=warn,wgpu_hal::vulkan::instance=error,gpui_component::theme::mono_font=error}"

    if command -v sccache >/dev/null 2>&1; then
        export RUSTC_WRAPPER="${RUSTC_WRAPPER:-sccache}"
        export CMAKE_C_COMPILER_LAUNCHER="${CMAKE_C_COMPILER_LAUNCHER:-sccache}"
        export CMAKE_CXX_COMPILER_LAUNCHER="${CMAKE_CXX_COMPILER_LAUNCHER:-sccache}"
        export CMAKE_CUDA_COMPILER_LAUNCHER="${CMAKE_CUDA_COMPILER_LAUNCHER:-sccache}"
        echo "==> sccache enabled (cached compiles for Rust + C/C++ + CUDA)"
    fi
}

# Sets CUDAHOSTCXX / CUDAARCHS for a dev (single-arch, fast) CUDA build.
# No-op for non-cuda modes or non-Linux.
setup_dev_cuda_env() {
    local mode="$1"
    case "$(uname -s)" in
        Linux)
            # Fedora 44 ships gcc 16; CUDA 13.2's nvcc only supports gcc ≤ 15.
            if [[ "$mode" == "cuda" && -z "${CUDAHOSTCXX:-}" ]]; then
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
            if [[ "$mode" == "cuda" && -z "${CUDAARCHS:-}" ]]; then
                local cc
                cc=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | head -1 | tr -d '.')
                : "${cc:=86}"
                export CUDAARCHS="${cc}-real"
                echo "==> CUDAARCHS=$CUDAARCHS (single-arch dev build)"
            fi
            ;;
    esac
}

# Resolves "auto" to cuda/cpu based on nvidia-smi presence.
resolve_auto_mode() {
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
        echo cuda
    else
        echo cpu
    fi
}

run_tauri_dev() {
    local mode="$1"
    cd "$ROOT/frontend"

    if ! command -v pnpm >/dev/null 2>&1; then
        echo "error: pnpm not found (install via 'npm i -g pnpm' or 'corepack enable')" >&2
        exit 1
    fi
    if [[ ! -d node_modules ]]; then
        echo "==> Installing JS deps"
        pnpm install --frozen-lockfile
    fi

    if [[ "$mode" == "frontend" ]]; then
        echo "==> Running pnpm dev (Next.js Turbopack on :3118)"
        echo "    Tauri APIs (invoke / events) will not work in this mode."
        exec pnpm dev
    fi

    # sherpa-onnx is linked dynamically (via the `shared` Cargo feature) to
    # avoid the static-onnxruntime conflict with whisper-rs. The build script
    # drops libsherpa-onnx-c-api.so / libonnxruntime.so into target/debug/
    # but doesn't set an rpath, so the loader needs to be told where to look.
    # Production builds will need this baked into the bundle's library dir.
    local sherpa_lib_dir="$ROOT/target/debug"
    if [[ -d "$sherpa_lib_dir" ]]; then
        export LD_LIBRARY_PATH="$sherpa_lib_dir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    fi

    setup_dev_cuda_env "$mode"

    local script="tauri:dev"
    case "$mode" in
        cuda)   script="tauri:dev:cuda" ;;
        vulkan) script="tauri:dev:vulkan" ;;
        cpu)    script="tauri:dev:cpu" ;;
    esac

    echo "==> Running pnpm $script"
    echo "    Frontend HMR: http://localhost:3118"
    echo "    Press Ctrl+C to stop both Rust and Next.js processes."
    exec pnpm run "$script"
}

run_gpui_dev() {
    local mode="$1"
    cd "$ROOT"

    # meetily-gpui's build.rs embeds an $ORIGIN rpath for the binary, but
    # `cargo run`'s target dir layout still needs LD_LIBRARY_PATH pointed at
    # target/debug for the dynamically-linked sherpa-onnx libs (same as the
    # Tauri dev path above).
    local sherpa_lib_dir="$ROOT/target/debug"
    if [[ -d "$sherpa_lib_dir" ]]; then
        export LD_LIBRARY_PATH="$sherpa_lib_dir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    fi

    setup_dev_cuda_env "$mode"

    # llama-helper sidecar, built in *release* even for dev: a debug
    # llama.cpp is far too slow for real summaries, and this reuses the same
    # cached build `./build.sh` produces. Its CUDA objects must be
    # position-independent or rust-lld refuses to link them (same export as
    # build.sh). Note llama-cpp-sys doesn't rebuild when this env var
    # changes, so a stale non-PIC build needs `cargo clean -p llama-cpp-sys-2`.
    export CMAKE_POSITION_INDEPENDENT_CODE="${CMAKE_POSITION_INDEPENDENT_CODE:-ON}"
    local helper_features=()
    case "$mode" in
        cuda)   helper_features=(--features cuda) ;;
        vulkan) helper_features=(--features vulkan) ;;
    esac
    echo "==> Building llama-helper sidecar (${mode}, release)"
    ( cd "$ROOT/llama-helper" && cargo build --release "${helper_features[@]}" )
    export MEETILY_LLAMA_HELPER="${MEETILY_LLAMA_HELPER:-$ROOT/target/release/llama-helper}"

    local gpui_features=()
    case "$mode" in
        cuda)   gpui_features=(--features cuda) ;;
        vulkan) gpui_features=(--features vulkan) ;;
    esac

    echo "==> Running cargo run -p meetily-gpui (${mode})"
    if (( ${#gpui_features[@]} )); then
        exec cargo run -p meetily-gpui "${gpui_features[@]}"
    else
        exec cargo run -p meetily-gpui
    fi
}

# ----- arg parsing -----

FIRST="${1:-auto}"
case "$FIRST" in
    --help|-h)
        sed -n '2,25p' "$SELF" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
esac

GPUI=0
if [[ "$FIRST" == "gpui" ]]; then
    GPUI=1
    MODE="${2:-auto}"
else
    MODE="$FIRST"
fi

if [[ "$MODE" == "auto" ]]; then
    MODE="$(resolve_auto_mode)"
fi

if [[ "$GPUI" -eq 1 ]]; then
    case "$MODE" in
        cuda|vulkan|cpu) ;;
        *)
            echo "error: unknown gpui mode '$MODE' (expected: cuda, vulkan, cpu, auto)" >&2
            exit 2
            ;;
    esac
else
    case "$MODE" in
        cuda|vulkan|cpu|frontend) ;;
        *)
            echo "error: unknown mode '$MODE' (expected: cuda, vulkan, cpu, frontend, gpui, auto)" >&2
            exit 2
            ;;
    esac
fi

if [[ "$GPUI" -eq 1 ]]; then
    echo "==> Dev mode: gpui ($MODE)"
else
    echo "==> Dev mode: $MODE"
fi

setup_common_env

if [[ "$GPUI" -eq 1 ]]; then
    run_gpui_dev "$MODE"
else
    run_tauri_dev "$MODE"
fi
