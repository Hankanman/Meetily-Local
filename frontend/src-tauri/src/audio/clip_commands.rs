//! Tauri command wrappers for per-segment audio clip playback. Core logic
//! (clip extraction via ffmpeg, WAV parsing) lives in `audio::clip`.

use base64::Engine;
use tauri::{AppHandle, Runtime};

use crate::audio::clip::{extract_clip_wav, parse_wav_pcm16};
use crate::state::AppState;

/// Extract `[start_secs, end_secs]` of a meeting's recording as a base64 WAV
/// (mono 16 kHz PCM). Kept for compatibility; playback now goes through
/// [`play_meeting_audio_clip`] and the native audio path.
#[tauri::command]
pub async fn get_meeting_audio_clip<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    start_secs: f64,
    end_secs: f64,
    source: Option<String>,
) -> Result<String, String> {
    let pool = state.db_manager.pool();
    let bytes = extract_clip_wav(pool, &meeting_id, start_secs, end_secs, source.as_deref()).await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Play `[start_secs, end_secs]` of a meeting's recording through the native
/// audio output. Returns as soon as playback starts; a `segment-playback-ended`
/// event fires when the clip finishes on its own (see [`crate::audio::playback`]).
#[tauri::command]
pub async fn play_meeting_audio_clip<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    start_secs: f64,
    end_secs: f64,
    source: Option<String>,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    let bytes = extract_clip_wav(pool, &meeting_id, start_secs, end_secs, source.as_deref()).await?;
    let (samples, sample_rate, channels) =
        tokio::task::spawn_blocking(move || parse_wav_pcm16(&bytes))
            .await
            .map_err(|e| format!("Clip decode task failed: {}", e))??;
    crate::audio::playback::play_pcm_i16(&crate::tauri_events::shared_sink(&app), samples, sample_rate, channels)
}

/// Stop any transcript-segment clip that's currently playing.
#[tauri::command]
pub fn stop_meeting_audio_clip() {
    crate::audio::playback::stop();
}
