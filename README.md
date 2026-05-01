<div align="center" style="border-bottom: none">
    <h1>
        Meetily-Local — Privacy-First AI Meeting Assistant
    </h1>
    <a href="https://github.com/Hankanman/Meetily-Local/releases"><img src="https://img.shields.io/badge/License-MIT-blue" alt="License"></a>
    <a href="https://github.com/Hankanman/Meetily-Local/releases"><img src="https://img.shields.io/badge/Supported_OS-Linux,_macOS,_Windows-white" alt="Supported OS"></a>
    <a href="https://github.com/Hankanman/Meetily-Local/releases"><img alt="GitHub Tag" src="https://img.shields.io/github/v/tag/Hankanman/Meetily-Local?include_prereleases&color=yellow"></a>
    <br>
    <h3>Open Source • Privacy-First • Independent Fork</h3>

A privacy-first AI meeting assistant that captures, transcribes, and summarizes meetings entirely on your local infrastructure. No cloud calls, no telemetry, no upsells — just an offline meeting tool that works.

<p align="center">
    <img src="docs/meetily_demo.gif" width="650" alt="Meetily-Local Demo" />
</p>

</div>

---

## About this fork

**Meetily-Local** is an independent fork of the original [Zackriya-Solutions/meeting-minutes](https://github.com/Zackriya-Solutions/meeting-minutes) project (the "Meetily Community Edition"), which is MIT-licensed.

This fork is **fully independent** — not technically a GitHub fork anymore — and there is no commercial product. Everything is and will remain MIT-licensed and free.

**What's different in Meetily-Local vs. upstream as of v0.4.0:**

- ✅ **Linux is a first-class target.** Audio capture (cpal/PipeWire), WebKitGTK rendering, and ALSA device enumeration all fixed and tested.
- ✅ **Modern dependencies.** `whisper-rs` 0.13 → 0.16 (drops ~30 MB of vendored patches), Tauri 2.6 → 2.11, all plugins current.

Credit for the original architecture, models, and significant feature work goes to [Sujith S](https://github.com/sujithatzackriya) and the original Zackriya-Solutions community. See [Acknowledgments](#acknowledgments).

---

## Introduction

Meetily-Local is a privacy-first AI meeting assistant that runs entirely on your local machine. It captures your meetings, transcribes them in real-time, and generates summaries — all without sending any data to a cloud you don't control. Suitable for professionals, teams, and individuals who need meeting intelligence without the privacy/compliance baggage of cloud meeting tools.

## Why this exists

While many meeting transcription tools exist, this one stands out by:

- **Privacy First** — All processing happens locally. No telemetry, no cloud round-trips by default.
- **Cost-Effective** — Uses open-source models (Whisper, Parakeet, local Ollama / llama.cpp) instead of metered APIs.
- **Flexible** — Works fully offline; supports any meeting platform (it captures system audio, not specific apps).
- **Customisable** — Self-host, fork, modify; everything is MIT.

## Features

- **Local-first** — All processing on your machine. No data leaves your computer unless you explicitly point it at a remote LLM endpoint.
- **Real-time transcription** — Live transcript as the meeting happens, via Whisper or Parakeet.
- **AI-powered summaries** — Generate meeting summaries with the LLM provider of your choice.
- **Cross-platform** — Linux (first-class in this fork), macOS, Windows.
- **Open source** — MIT, no upsell.
- **Flexible AI providers** — Ollama (local, recommended), Claude, Groq, OpenRouter, or any OpenAI-compatible endpoint.
- **GPU acceleration** — Metal + CoreML on macOS; CUDA / Vulkan / HIP on Windows / Linux.

## Installation

Pre-built binaries are published to this fork's [Releases](https://github.com/Hankanman/Meetily-Local/releases) page when tagged.

### 🐧 Linux

The `.AppImage` works on most distros (Fedora 43+, Ubuntu 22.04+, Arch, etc.):

```bash
curl -LO https://github.com/Hankanman/Meetily-Local/releases/latest/download/meetily_amd64.AppImage
chmod +x meetily_amd64.AppImage
./meetily_amd64.AppImage
```

A `.deb` is also published for Debian/Ubuntu users.

### 🪟 Windows

Download the latest `.msi` or `setup.exe` from [Releases](https://github.com/Hankanman/Meetily-Local/releases/latest) and run it.

### 🍎 macOS

Download the latest `.dmg` from [Releases](https://github.com/Hankanman/Meetily-Local/releases/latest), open it, and drag **Meetily-Local** to your Applications folder.

## Build from source

Clone, then run the all-in-one build script:

```bash
git clone https://github.com/Hankanman/Meetily-Local.git
cd Meetily-Local
./build.sh           # auto: CUDA on Linux with NVIDIA, CPU otherwise
./build.sh cuda      # NVIDIA explicit
./build.sh vulkan    # AMD/Intel
./build.sh cpu       # CPU only
./build.sh --help
```

`build.sh` handles the gnarly Fedora 44 / CUDA 13 build environment (gcc 16 → g++-15 host, `CUDAARCHS` for Turing+, `NO_STRIP=1` for linuxdeploy). On other distros you can override individual env vars.

To start fresh: `./clean.sh` (nukes `target/` + `node_modules/` + Next.js caches; preserves user data and models).

For platform-specific deep-dives, see [`docs/building_in_linux.md`](docs/building_in_linux.md) and [`docs/BUILDING.md`](docs/BUILDING.md).

## Key features

### 🎯 Local transcription

Transcribe meetings entirely on your device using **Whisper** (ggml) or **Parakeet** (ONNX).

<p align="center">
    <img src="docs/home.png" width="650" style="border-radius: 10px;" alt="Local transcription" />
</p>

### 📥 Import & enhance `Beta`

Import existing audio files to generate transcripts, or re-transcribe any recorded meeting with a different model or language.

<p align="center">
    <img src="docs/meetily-export.gif" width="650" style="border-radius: 10px;" alt="Import and Enhance" />
</p>

### 🤖 AI-powered summaries

Generate summaries with your choice of provider — local **Ollama** is recommended for full privacy, with Claude / Groq / OpenRouter / any OpenAI-compatible endpoint also supported.

<p align="center">
    <img src="docs/summary.png" width="650" style="border-radius: 10px;" alt="Summary generation" />
</p>

### 🔒 Privacy-first by default

All audio, transcripts, models, and summaries stay on your machine. No telemetry. The only network traffic is what you explicitly configure (e.g. a remote Ollama endpoint or a cloud LLM API key you provide).

<p align="center">
    <img src="docs/settings.png" width="650" style="border-radius: 10px;" alt="Settings" />
</p>

### 🎙️ Professional audio mixing

Capture microphone and system audio simultaneously with intelligent RMS-based ducking and clipping prevention.

<p align="center">
    <img src="docs/audio.png" width="650" style="border-radius: 10px;" alt="Audio device selection" />
</p>

### ⚡ GPU acceleration

- **macOS**: Apple Silicon (Metal) + CoreML
- **Windows/Linux**: NVIDIA (CUDA), AMD/Intel (Vulkan), AMD ROCm (HIP)

Selected automatically at build time by `build.sh`.

## System architecture

Meetily-Local is a single self-contained Tauri 2.x desktop application:

- **Backend (Rust)**: audio capture, mixing, VAD, Whisper/Parakeet inference, sqlite persistence
- **Frontend (Next.js + React)**: UI, meeting management, settings
- **No external server required** for core operation. An optional companion FastAPI backend exists in the `backend/` directory for users who want a network-accessible meeting service.

For more details, see [docs/architecture.md](docs/architecture.md).

## Contributing

PRs welcome. Open an issue first if you're planning a non-trivial change so we can align on direction. The bar for "non-trivial" is low — there's no review backlog and no "PRO" tier this needs to dodge.

If you're contributing a Linux fix, make sure `./build.sh` produces a working AppImage on your distro before opening the PR.

## License

[MIT](LICENSE) — same as the original project. Use this for your own purposes, fork it, ship it, sell support, whatever. Just don't claim you wrote the parts you didn't.

## Acknowledgments

This fork builds on substantial prior work:

- **[Zackriya-Solutions/meeting-minutes](https://github.com/Zackriya-Solutions/meeting-minutes)** — original Meetily Community Edition. Architecture, much of the core feature set, original UI design, and significant Tauri/Rust scaffolding came from there. Lead author: [Sujith S](https://github.com/sujithatzackriya).
- **[Whisper.cpp](https://github.com/ggerganov/whisper.cpp)** — fast inference engine for Whisper.
- **[Screenpipe](https://github.com/mediar-ai/screenpipe)** — some audio capture code.
- **[transcribe-rs](https://crates.io/crates/transcribe-rs)** — additional audio plumbing.
- **NVIDIA** — for the **Parakeet** model.
- **[istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)** — ONNX conversion of Parakeet.
- All contributors to the original community edition who shaped this codebase before the fork.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=Hankanman/Meetily-Local&type=Date)](https://star-history.com/#Hankanman/Meetily-Local&Date)
