# Building Meetily-Local from Source

Meetily-Local (Parley) is a Linux-only GPUI desktop app. macOS and Windows are
dropped platforms — see [README.md](../README.md) and [CLAUDE.md](../CLAUDE.md)
for background.

## Quick start

```bash
git clone https://github.com/Hankanman/Meetily-Local.git
cd Meetily-Local
./build.sh           # production build → Parley-<version>-x86_64.AppImage (auto: CUDA on NVIDIA, CPU otherwise)
./dev.sh              # development mode, cargo run -p meetily-gpui
./clean.sh             # nuke target/
```

For the full guide — dependency installation, GPU setup (CUDA/Vulkan),
environment variable reference, and troubleshooting — see
**[docs/building_in_linux.md](building_in_linux.md)**.
