//! Native audio output for transcript-segment clip playback.
//!
//! The AppImage bundles the GStreamer *core* libraries but none of its
//! plugins, and points WebKit at that empty plugin set — so every webview
//! audio path (both `<audio>` and the Web Audio API) fails with
//! "element appsink not found". Rather than fix the webview media stack, we
//! play the short verification clips natively here, which also keeps the app
//! self-contained and consistent with its native PipeWire capture.
//!
//! rodio's `OutputStream` owns a `!Send` cpal stream, so it can't live in a
//! global or move between threads. We park it forever on a dedicated thread
//! and hand out the (Send) `OutputStreamHandle`; sinks are built from that
//! handle on demand. Only one clip plays at a time — starting a new one
//! replaces the previous.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

use rodio::buffer::SamplesBuffer;
use rodio::{OutputStream, OutputStreamHandle, Sink};
use tauri::{AppHandle, Emitter, Runtime};

/// Emitted (payload: the playback generation) when a clip finishes on its own,
/// so the UI can clear the "playing" state. Not emitted when playback is
/// replaced or explicitly stopped.
pub const PLAYBACK_ENDED_EVENT: &str = "segment-playback-ended";

/// Monotonic token identifying the active playback. Bumped on every play and
/// stop so a finishing clip only announces its end if it's still the current
/// one.
static GENERATION: AtomicU64 = AtomicU64::new(0);

struct Player {
    handle: OutputStreamHandle,
    current: Mutex<Option<Arc<Sink>>>,
}

/// Lazily bring up the audio output thread. Returns a shared error (cloned)
/// when no output device is available, so callers surface a clean message.
fn player() -> Result<&'static Player, String> {
    static PLAYER: OnceLock<Result<Player, String>> = OnceLock::new();
    PLAYER
        .get_or_init(|| {
            let (tx, rx) = mpsc::channel();
            std::thread::Builder::new()
                .name("meetily-audio-out".into())
                .spawn(move || match OutputStream::try_default() {
                    Ok((stream, handle)) => {
                        let _ = tx.send(Ok(handle));
                        // `stream` is `!Send` and must outlive every sink built
                        // from its handle; keep it alive here for the app's life.
                        let _keep_alive = stream;
                        loop {
                            std::thread::park();
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(format!("No audio output device: {e}")));
                    }
                })
                .map_err(|e| format!("Failed to start audio thread: {e}"))?;
            rx.recv()
                .map_err(|_| "Audio output thread exited".to_string())?
                .map(|handle| Player {
                    handle,
                    current: Mutex::new(None),
                })
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// Play interleaved 16-bit PCM natively, replacing any clip already playing.
/// Returns as soon as playback starts.
pub fn play_pcm_i16<R: Runtime>(
    app: &AppHandle<R>,
    samples: Vec<i16>,
    sample_rate: u32,
    channels: u16,
) -> Result<(), String> {
    let active = player()?;
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // Stop whatever was playing before starting the replacement.
    if let Some(prev) = active.current.lock().unwrap().take() {
        prev.stop();
    }

    let sink = Sink::try_new(&active.handle)
        .map_err(|e| format!("Failed to create audio sink: {e}"))?;
    sink.append(SamplesBuffer::new(channels, sample_rate, samples));
    let sink = Arc::new(sink);
    *active.current.lock().unwrap() = Some(sink.clone());

    // Watch for natural completion. `sleep_until_end` also returns when the
    // sink is stopped (by a replacement or an explicit stop); the generation
    // check ensures only a genuine, still-current end emits the event.
    let app = app.clone();
    std::thread::spawn(move || {
        sink.sleep_until_end();
        if GENERATION.load(Ordering::SeqCst) == generation {
            if let Ok(active) = player() {
                let mut current = active.current.lock().unwrap();
                if current.as_ref().is_some_and(|s| Arc::ptr_eq(s, &sink)) {
                    *current = None;
                }
            }
            let _ = app.emit(PLAYBACK_ENDED_EVENT, generation);
        }
    });

    Ok(())
}

/// Stop the currently playing clip, if any.
pub fn stop() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Ok(player) = player() {
        if let Some(sink) = player.current.lock().unwrap().take() {
            sink.stop();
        }
    }
}
