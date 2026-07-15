# Building Meetily-Local from Source

Meetily-Local is a Linux-only Tauri desktop app. macOS and Windows are
dropped platforms — see [README.md](../README.md) and [CLAUDE.md](../CLAUDE.md)
for background.

## Quick start

```bash
git clone https://github.com/Hankanman/Meetily-Local.git
cd Meetily-Local
./build.sh           # production build (auto: CUDA on NVIDIA, CPU otherwise)
./dev.sh              # development mode, hot reload
./clean.sh             # nuke target/ + node_modules/ + Next.js caches
```

For the full guide — dependency installation, GPU setup (CUDA/Vulkan),
environment variable reference, and troubleshooting — see
**[docs/building_in_linux.md](building_in_linux.md)**.
