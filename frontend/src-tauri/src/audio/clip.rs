//! Per-segment audio clip playback for the meeting-details transcript.
//!
//! Extracts a `[start, end]` slice of a meeting's recording as a small WAV and
//! returns it (base64) so the webview can play a single transcript segment —
//! mainly so the user can listen and verify who's speaking. Decoding uses the
//! bundled ffmpeg rather than the webview's media stack, which on some Linux
//! setups (incomplete GStreamer) can't play the mp4 recording directly, and
//! WAV/PCM plays reliably through the Web Audio API.

use base64::Engine;
use tauri::{AppHandle, Runtime};

use crate::audio::ffmpeg::find_ffmpeg_path;
use crate::database::models::MeetingModel;
use crate::state::AppState;

/// Upper bound on clip length, guarding against a bogus range producing a huge
/// extraction. Real transcript segments are seconds long.
const MAX_CLIP_SECS: f64 = 120.0;

/// Extract `[start_secs, end_secs]` of a meeting's recording as a base64 WAV
/// (mono 16 kHz PCM). Errors with a user-facing message when the meeting has no
/// saved recording.
#[tauri::command]
pub async fn get_meeting_audio_clip<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    start_secs: f64,
    end_secs: f64,
) -> Result<String, String> {
    let pool = state.db_manager.pool();

    let meeting: Option<MeetingModel> = sqlx::query_as(
        "SELECT id, title, created_at, updated_at, folder_path FROM meetings WHERE id = ?",
    )
    .bind(&meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Database error: {}", e))?;

    let folder_path = meeting
        .and_then(|m| m.folder_path)
        .ok_or_else(|| "This meeting has no saved recording.".to_string())?;

    let audio_path = std::path::Path::new(&folder_path).join("audio.mp4");
    if !audio_path.is_file() {
        return Err("No audio recording found for this meeting.".to_string());
    }

    let ffmpeg = find_ffmpeg_path().ok_or_else(|| "ffmpeg is not available.".to_string())?;

    let start = start_secs.max(0.0);
    let dur = (end_secs - start_secs).clamp(0.05, MAX_CLIP_SECS);

    // Extract to a temp WAV *file* (not a pipe): ffmpeg can then seek back and
    // write a correct RIFF size header, which some decoders require. Mono
    // 16 kHz PCM is ample for an ear check and keeps the payload small.
    let tmp = tempfile::Builder::new()
        .prefix("meetily-clip-")
        .suffix(".wav")
        .tempfile()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    let tmp_path = tmp.path().to_path_buf();

    let audio_path_str = audio_path.to_string_lossy().into_owned();
    let tmp_path_str = tmp_path.to_string_lossy().into_owned();

    let status = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&ffmpeg)
            .args([
                "-nostdin",
                "-loglevel",
                "error",
                "-y",
                // Seek before -i for a fast input seek; -t after -i bounds the
                // output duration from that point.
                "-ss",
                &format!("{:.3}", start),
                "-i",
                &audio_path_str,
                "-t",
                &format!("{:.3}", dur),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
                &tmp_path_str,
            ])
            .status()
    })
    .await
    .map_err(|e| format!("ffmpeg task failed: {}", e))?
    .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !status.success() {
        return Err("Failed to extract the audio clip.".to_string());
    }

    let bytes = std::fs::read(&tmp_path).map_err(|e| format!("Failed to read clip: {}", e))?;
    if bytes.is_empty() {
        return Err("The extracted clip was empty.".to_string());
    }

    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
