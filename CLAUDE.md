# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Meetily-Local** is a privacy-first AI meeting assistant that captures, transcribes, and summarizes meetings entirely on local infrastructure. It's a single self-contained Tauri desktop application — no separate backend server.

### Key Technology Stack
- **Desktop shell**: Tauri 2.11 (Rust) + Next.js 16 + React 19 + Tailwind 4
- **Audio Processing**: Rust (native PipeWire capture, whisper-rs, professional audio mixing)
- **Transcription**: Whisper.cpp (local, GPU-accelerated, in-process via whisper-rs)
- **Persistence**: SQLite via sqlx in the Tauri Rust process
- **LLM Integration**: built-in llama.cpp sidecar (`llama-helper` crate), or remote Ollama / Claude / Groq / OpenRouter / OpenAI-compatible endpoint

## Essential Development Commands

### Frontend Development (Tauri Desktop App)

Root-level scripts (recommended — handle CUDA/Vulkan env setup and the `llama-helper` sidecar build for you):

```bash
./dev.sh                    # auto: full Tauri dev, CUDA on NVIDIA, CPU otherwise
./dev.sh cuda                # NVIDIA CUDA
./dev.sh vulkan               # AMD/Intel Vulkan
./dev.sh cpu                  # CPU-only
./dev.sh frontend             # frontend-only (next dev), no Tauri shell — fastest UI loop
./build.sh                    # production build (same mode selection as dev.sh)
./clean.sh                    # nuke target/ + node_modules/ + Next.js caches
```

**Location**: `/frontend` (manual `pnpm` commands, if you don't want the root scripts):

```bash
pnpm install                 # Install dependencies
pnpm run dev                 # Next.js dev server (port 3118)
pnpm run tauri:dev:cpu       # Full Tauri dev, CPU-only
pnpm run tauri:dev:cuda      # Full Tauri dev, NVIDIA CUDA
pnpm run tauri:dev:vulkan    # Full Tauri dev, AMD/Intel Vulkan
pnpm run tauri:build:cpu     # Production build, CPU-only
pnpm run tauri:build:cuda    # Production build, NVIDIA CUDA
pnpm run tauri:build:vulkan  # Production build, AMD/Intel Vulkan
```

### Service Endpoint
- **Frontend Dev**: http://localhost:3118 (Next.js Turbopack with HMR)

The Tauri Rust side has no HTTP listener — frontend ↔ Rust communication is
all in-process via `invoke()` commands and emitted events.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Tauri Desktop App (single process)           │
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │ Next.js UI       │    │ Rust core                        │  │
│  │ (React/TS)       │←──→│   • Audio capture + mixing + VAD │  │
│  │                  │    │   • whisper-rs / parakeet        │  │
│  └──────────────────┘    │   • SQLite via sqlx              │  │
│         ↑ Tauri events   │   • Summary engine               │  │
│         ↓ invoke()       │   • llama-helper sidecar         │  │
│                          └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                ↓ optional outbound LLM calls
   Ollama (local or remote) / Claude / Groq / OpenRouter / custom OpenAI
```

### Audio Processing Pipeline (Critical Understanding)

The audio system has **two parallel paths** with different purposes:

```
Raw Audio (Mic + System)
         ↓
┌────────────────────────────────────────────────────────────┐
│              Audio Pipeline Manager                         │
│  (frontend/src-tauri/src/audio/pipeline.rs)                │
└─────────────┬──────────────────────────┬───────────────────┘
              ↓                          ↓
    ┌─────────────────┐        ┌─────────────────────┐
    │ Recording Path  │        │ Transcription Path  │
    │ (Pre-mixed)     │        │ (VAD-filtered)      │
    └─────────────────┘        └─────────────────────┘
              ↓                          ↓
    RecordingSaver.save()      WhisperEngine.transcribe()
```

**Key Insight**: The pipeline performs **professional audio mixing** (RMS-based ducking, clipping prevention) for recording, while simultaneously applying **Voice Activity Detection (VAD)** to send only speech segments to Whisper for transcription.

### Audio Architecture: Native PipeWire Capture

**Context**: Linux audio input was rewritten to talk to PipeWire directly, replacing the previous cpal-ALSA + `pactl` + `PIPEWIRE_NODE`-env-var stack. See the module doc comment at the top of `audio/pw/mod.rs` for the rationale.

```
audio/
├── devices/                    # Device model + PipeWire-backed discovery
│   ├── discovery.rs           # list_audio_devices, trigger_audio_permission
│   └── configuration.rs       # AudioDevice, DeviceType
├── pw/                         # Native PipeWire capture layer (mic + system audio)
├── pipeline.rs                 # Audio mixing and VAD processing
├── device_detection.rs         # Bluetooth vs wired classification for adaptive buffering
├── hardware_detector.rs        # GPU/perf tier detection
├── recording_manager.rs        # High-level recording coordination
├── recording_commands.rs       # Tauri command interface
├── recording_saver.rs          # Audio file writing
├── import.rs                   # Import external audio files as new meetings
├── retranscription.rs          # Re-process stored audio with different settings
└── transcription/               # Provider abstraction, engine management, worker pool
```

**When working on audio features**:
- Device detection issues → `devices/discovery.rs` or `devices/configuration.rs`
- Capture issues (mic/system audio) → `pw/`
- Mixing/processing problems → `pipeline.rs`
- Recording workflow → `recording_manager.rs`

### Rust ↔ Frontend Communication (Tauri Architecture)

**Command Pattern** (Frontend → Rust):
```typescript
// Frontend: src/app/page.tsx
await invoke('start_recording', {
  mic_device_name: "Built-in Microphone",
  system_device_name: "Family 17h/19h/1ah HD Audio Controller Analog Stereo",
  meeting_name: "Team Standup"
});
```

```rust
// Rust: src/lib.rs
#[tauri::command]
async fn start_recording<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>
) -> Result<(), String> {
    // Implementation delegates to audio::recording_commands
}
```

**Event Pattern** (Rust → Frontend):
```rust
// Rust: Emit transcript updates
app.emit("transcript-update", TranscriptUpdate {
    text: "Hello world".to_string(),
    timestamp: chrono::Utc::now(),
    // ...
})?;
```

```typescript
// Frontend: Listen for events
await listen<TranscriptUpdate>('transcript-update', (event) => {
  setTranscripts(prev => [...prev, event.payload]);
});
```

### Whisper Model Management

**Model Storage Locations**:
- **Development**: `frontend/models/`
- **Production (Linux)**: `~/.local/share/com.meetily.ai/models/`

**Model Loading** (frontend/src-tauri/src/whisper_engine/whisper_engine.rs):
```rust
pub async fn load_model(&self, model_name: &str) -> Result<()> {
    // Automatically detects GPU capabilities (CUDA/Vulkan)
    // Falls back to CPU if GPU unavailable
}
```

**GPU Acceleration**:
- CUDA (NVIDIA), Vulkan (AMD/Intel), or CPU fallback
- Configure via Cargo features: `--features cuda`, `--features vulkan` (auto-selected by `build.sh`/`dev.sh`)

## Critical Development Patterns

### 1. Audio Buffer Management

**Ring Buffer Mixing** (pipeline.rs):
- Mic and system audio arrive asynchronously at different rates
- Ring buffer accumulates samples until both streams have aligned windows (50ms)
- Professional mixing applies RMS-based ducking to prevent system audio from drowning out microphone
- Uses `VecDeque` for efficient windowed processing

### 2. Thread Safety and Async Boundaries

**Recording State** (recording_state.rs):
```rust
pub struct RecordingState {
    is_recording: Arc<AtomicBool>,
    audio_sender: Arc<RwLock<Option<mpsc::UnboundedSender<AudioChunk>>>>,
    // ...
}
```

**Key Pattern**: Use `Arc<RwLock<T>>` for shared state across async tasks, `Arc<AtomicBool>` for simple flags.

### 3. Error Handling and Logging

**Performance-Aware Logging** (lib.rs):
```rust
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => { log::debug!($($arg)*) };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};  // Zero overhead in release builds
}
```

**Usage**: Use `perf_debug!()` and `perf_trace!()` for hot-path logging that should be eliminated in production.

### 4. Frontend State Management

**Sidebar Context** (components/Sidebar/SidebarProvider.tsx):
- Global state for meetings list, current meeting, recording status
- Communicates with the Rust side exclusively via Tauri `invoke()` commands
- No HTTP/WebSocket — everything is in-process

**Pattern**: Tauri commands update Rust state → Emit events → Frontend listeners update React state → Context propagates to components

## Common Development Tasks

### Adding a New Tauri Command

1. Define command in `src/lib.rs`:
   ```rust
   #[tauri::command]
   async fn my_command(arg: String) -> Result<String, String> { /* ... */ }
   ```
2. Register in `tauri::Builder`:
   ```rust
   .invoke_handler(tauri::generate_handler![
       start_recording,
       my_command,  // Add here
   ])
   ```
3. Call from frontend:
   ```typescript
   const result = await invoke<string>('my_command', { arg: 'value' });
   ```

### Modifying Audio Pipeline Behavior

**Location**: `frontend/src-tauri/src/audio/pipeline.rs`

Key components:
- `AudioMixerRingBuffer`: Manages mic + system audio synchronization
- `ProfessionalAudioMixer`: RMS-based ducking and mixing
- `AudioPipelineManager`: Orchestrates VAD, mixing, and distribution

**Testing Audio Changes**:
```bash
# Enable verbose audio logging
RUST_LOG=app_lib::audio=debug ./dev.sh

# Monitor audio metrics in real-time
# Check Developer Console in the app (Ctrl+Shift+I)
```

### Adding a Tauri Command (Rust → frontend)

Define in any module under `src-tauri/src/api/` or similar, register in
`lib.rs`'s `generate_handler![]` block, call from JS via `invoke()`. SQLite
persistence goes through sqlx; see `database/repositories/*.rs` for the
existing repository patterns.

## Testing and Debugging

### Frontend Debugging

**Enable Rust Logging**:
```bash
RUST_LOG=debug ./dev.sh
```

**Developer Tools**:
- Open DevTools: `Ctrl+Shift+I`
- Console Toggle: Built into app UI (console icon)
- View Rust logs: Check terminal output

### Audio Pipeline Debugging

**Key Metrics** (emitted by pipeline):
- Buffer sizes (mic/system)
- Mixing window count
- VAD detection rate
- Dropped chunk warnings

**Monitor via Developer Console**: The app includes real-time metrics display when recording.

## Platform Notes

Linux is the only supported platform (see [Repository-Specific Conventions](#repository-specific-conventions)).

- **Audio Capture**: Native PipeWire (`audio/pw/`) for both microphone and system audio — no virtual device or loopback trick needed
- **GPU**: CUDA (NVIDIA) or Vulkan (AMD/Intel) via Cargo features, CPU fallback otherwise
- **Dependencies**: Requires cmake, llvm, libomp — see [docs/building_in_linux.md](docs/building_in_linux.md)

## Performance Optimization Guidelines

### Audio Processing
- Use `perf_debug!()` / `perf_trace!()` for hot-path logging (zero cost in release)
- Batch audio metrics using `AudioMetricsBatcher` (pipeline.rs)
- Pre-allocate buffers with `AudioBufferPool` (buffer_pool.rs)
- VAD filtering reduces Whisper load by ~70% (only processes speech)

### Whisper Transcription
- **Model Selection**: Balance accuracy vs speed
  - Development: `base` or `small` (fast iteration)
  - Production: `medium` or `large-v3` (best quality)
- **GPU Acceleration**: 5-10x faster than CPU
- **Parallel Processing**: Available in `whisper_engine/parallel_processor.rs` for batch workloads

### Frontend Performance
- React state updates batched via Sidebar context
- Transcript rendering virtualized for large meetings
- Audio level monitoring throttled to 60fps

## Important Constraints and Gotchas

1. **Audio Chunk Size**: Pipeline expects consistent 48kHz sample rate. Resampling happens at capture time.

2. **Audio Capture**: Mic + system audio both go through native PipeWire (`audio/pw/`) — no virtual device or exclusive-mode juggling needed.

3. **Whisper Model Loading**: Models are loaded once and cached. Changing models requires app restart or manual unload/reload.

4. **No external server**: meeting persistence, transcription, summary
   generation all happen inside the Tauri Rust process. The old `backend/`
   FastAPI dir was deleted; if you see references to `:5167` they're
   stale.

5. **File Paths**: Use Tauri's path APIs (`downloadDir`, etc.) for cross-platform compatibility. Never hardcode paths.

7. **Audio Permissions**: Request microphone permission early; PipeWire handles system-audio routing without a separate OS-level screen-recording grant.

## Repository-Specific Conventions

- **Logging Format**: Backend uses detailed formatting with filename:line:function
- **Error Handling**: Rust uses `anyhow::Result`, frontend uses try-catch with user-friendly messages
- **Naming**: Audio devices use "microphone" and "system" consistently (not "input"/"output")
- **Git Branches**:
  - `main`: Stable releases
  - `fix/*`: Bug fixes
  - `enhance/*`: Feature enhancements

## Key Files Reference

**Core Coordination**:
- [frontend/src-tauri/src/lib.rs](frontend/src-tauri/src/lib.rs) - Main Tauri entry point, command registration
- [frontend/src-tauri/src/audio/mod.rs](frontend/src-tauri/src/audio/mod.rs) - Audio module exports
- [frontend/src-tauri/src/api/api.rs](frontend/src-tauri/src/api/api.rs) - Tauri command handlers (meetings, summaries, transcripts)

**Audio System**:
- [frontend/src-tauri/src/audio/recording_manager.rs](frontend/src-tauri/src/audio/recording_manager.rs) - Recording orchestration
- [frontend/src-tauri/src/audio/pipeline.rs](frontend/src-tauri/src/audio/pipeline.rs) - Audio mixing and VAD
- [frontend/src-tauri/src/audio/recording_saver.rs](frontend/src-tauri/src/audio/recording_saver.rs) - Audio file writing

**UI Components**:
- [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Main recording interface
- [frontend/src/components/Sidebar/SidebarProvider.tsx](frontend/src/components/Sidebar/SidebarProvider.tsx) - Global state management

**Whisper Integration**:
- [frontend/src-tauri/src/whisper_engine/whisper_engine.rs](frontend/src-tauri/src/whisper_engine/whisper_engine.rs) - Whisper model management and transcription
