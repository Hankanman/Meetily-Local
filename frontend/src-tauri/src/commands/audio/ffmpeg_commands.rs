// Tauri command wrappers for ffmpeg status/installation. Core logic lives in
// `audio::ffmpeg`.

use super::ffmpeg::FfmpegStatus;

/// Report whether ffmpeg is currently available and, if so, where it was
/// found. Used by the settings UI to show install status without
/// triggering a download (see `audio::ffmpeg::ensure_ffmpeg_installed` for
/// that).
#[tauri::command]
pub async fn ffmpeg_status() -> FfmpegStatus {
    super::ffmpeg::ffmpeg_status()
}
