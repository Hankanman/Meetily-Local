## 🐧 Building on Linux

Meetily-Local is Linux-only. This guide covers building from source using the
root-level `build.sh` / `dev.sh` / `clean.sh` scripts, which handle GPU-mode
selection, the gnarly Fedora/CUDA build-environment quirks, and the
`llama-helper` sidecar build for you.

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install build-essential cmake git \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  libasound2-dev libopenblas-dev libx11-dev libxtst-dev libxrandr-dev

# Fedora/RHEL
sudo dnf install gcc-c++ cmake git llvm openmp-devel

# Arch Linux
sudo pacman -S base-devel cmake git
```

You'll also need [pnpm](https://pnpm.io/installation) and a Rust toolchain
(`rustup`).

### 2. Build and Run

```bash
# From the repo root
./dev.sh              # development mode, hot reload
./build.sh             # production build → AppImage
```

**That's it.** Both scripts auto-detect NVIDIA GPUs (via `nvidia-smi`) and
build with CUDA; everything else falls back to CPU. Pass a mode explicitly to
override:

```bash
./dev.sh cuda          # NVIDIA CUDA
./dev.sh vulkan        # AMD/Intel Vulkan
./dev.sh cpu           # CPU-only
./dev.sh frontend      # frontend-only (next dev), no Tauri shell — fastest UI loop

./build.sh cuda
./build.sh vulkan
./build.sh cpu
```

Run `./build.sh --help` or `./dev.sh --help` for the full usage notes
(environment variable overrides, etc.) straight from the script.

---

## 🧠 How It Works

`build.sh` and `dev.sh` are self-contained — no separate GPU-detection script
is involved:

1. **Mode resolution**: `auto` (default) checks for a working `nvidia-smi` →
   `cuda`, else `cpu`. Pass `cuda` / `vulkan` / `cpu` to force a mode.
2. **Platform env setup** (Linux): auto-detects a compatible `g++` for `nvcc`
   on Fedora (CUDA 13 needs gcc ≤ 15), sets `CUDAARCHS`, enables
   `CMAKE_POSITION_INDEPENDENT_CODE` (required for `rust-lld` to link the CUDA
   `.cu.o` objects), and sets `NO_STRIP=1` (linuxdeploy's bundled `strip`
   chokes on Fedora 43+'s `SHT_RELR` sections).
3. **Sidecar build**: builds the `llama-helper` crate with the matching GPU
   feature and stages it into `frontend/src-tauri/binaries/`.
4. **Tauri build/dev**: runs `pnpm exec tauri build --bundles appimage` (or
   `tauri dev`) with `--features {cuda,vulkan}` passed through as needed.

| Mode     | Feature Flag          | Typical Speedup |
| -------- | ---------------------- | ---------------- |
| CUDA     | `--features cuda`      | 5-10x            |
| Vulkan   | `--features vulkan`    | 3-6x             |
| CPU      | (none)                 | 1x (baseline)    |

---

## 🔧 GPU Setup

### 🟢 NVIDIA CUDA

**Prerequisites:** NVIDIA GPU + CUDA toolkit installed.

```bash
# Ubuntu/Debian
sudo apt install nvidia-driver-550 nvidia-cuda-toolkit

# Verify
nvidia-smi          # Shows GPU info
nvcc --version       # Shows CUDA version

# Build (auto-detected if nvidia-smi works, or force it)
./build.sh cuda
```

`build.sh` defaults `CUDAARCHS` to `"75;80;86;89;90"` (Turing→Hopper) for a
portable release binary. `dev.sh` instead detects your specific compute
capability via `nvidia-smi --query-gpu=compute_cap` for a much faster
incremental build. Override either with `CUDAARCHS=... ./build.sh cuda`.

### 🔵 Vulkan (Cross-Platform Fallback)

Works on NVIDIA, AMD, and Intel GPUs — good choice if CUDA isn't available.

```bash
# Ubuntu/Debian
sudo apt install vulkan-sdk libopenblas-dev

# Fedora
sudo dnf install vulkan-devel openblas-devel

# Arch Linux
sudo pacman -S vulkan-devel openblas

./build.sh vulkan
```

### Other backends (AMD ROCm / OpenBLAS)

`whisper-rs` also exposes `hipblas` (AMD ROCm) and `openblas` Cargo features,
but they aren't wired into `build.sh`/`dev.sh` as a `--mode`. If you need
them, build the workspace directly, e.g.:

```bash
cargo build --release -p llama-helper --features hipblas
cd frontend && pnpm exec tauri build -- --features hipblas
```

This path is unsupported by the helper scripts — expect to hand-manage the
`llama-helper` sidecar staging step yourself (see step 3 above).

---

## 🎯 Advanced Usage

### Environment Variable Reference

| Variable            | Purpose                                       | Set by                    |
| -------------------- | ---------------------------------------------- | -------------------------- |
| `CUDAHOSTCXX`         | Host C++ compiler for `nvcc`                   | auto (Fedora g++-15/14)    |
| `CUDAARCHS`           | CUDA arch list                                 | auto (`75;80;86;89;90` for `build.sh`, single-arch for `dev.sh`) |
| `NO_STRIP`            | Skip AppImage symbol stripping                 | `build.sh` (`1`)           |
| `RUST_LOG`            | Log filter                                     | `dev.sh` (`info,whisper_rs=warn`) |
| `RUST_BACKTRACE`      | Full Rust backtraces on panic                  | `dev.sh` (`full`)          |

### Build Output Location

```
target/release/bundle/appimage/meetily_<version>_amd64.AppImage
```

The `.deb` bundle target is intentionally not produced — it doesn't bundle
`libsherpa-onnx-c-api.so`, so it wouldn't run on a clean host. The AppImage
embeds all native libs via linuxdeploy.

---

## 🧭 Troubleshooting

### "CUDA toolkit not found"
- **Fix:** Install `nvidia-cuda-toolkit` or ensure `nvcc --version` works.

### Fedora 44 build fails with a gcc/nvcc mismatch
- **Fix:** `build.sh`/`dev.sh` auto-detect `g++-15`/`g++-14` and set
  `CUDAHOSTCXX` for you. If neither is installed: `sudo dnf install gcc-c++15`
  (or the appropriate compat package for your Fedora release).

### AppImage build strips symbols / crashes at runtime
- **Fix:** Already handled — `build.sh` sets `NO_STRIP=1` on Linux
  automatically (Fedora 43+'s `SHT_RELR` sections trip up linuxdeploy's
  bundled `strip`).

### `Could not find dependency: libsherpa-onnx-c-api.so`
- **Fix:** Already handled — `build.sh` points linuxdeploy at
  `target/release` via `LD_LIBRARY_PATH` so it can find and bundle the lib.

### Build works but no GPU acceleration
- **Check:** `nvidia-smi` (NVIDIA) should work before `./build.sh` (or
  `./dev.sh`) auto-selects CUDA; otherwise pass the mode explicitly.

---

## ✅ Compiler Cache (optional, faster rebuilds)

If [`sccache`](https://github.com/mozilla/sccache) is installed, `build.sh`
and `dev.sh` enable it automatically for Rust + C/C++ + CUDA compiles.

```bash
cargo install sccache
./dev.sh   # picks it up automatically
```

---

**Need help?** Open an issue on [Hankanman/Meetily-Local](https://github.com/Hankanman/Meetily-Local/issues) with your GPU type, distro, and the output from `./build.sh`.
