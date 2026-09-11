// Tauri command wrappers around the checkpoint-recovery core logic in
// `audio::incremental_saver`. Kept separate so that module stays Tauri-free.

use super::incremental_saver::{self, AudioRecoveryStatus};

/// Recover audio from checkpoint files.
/// This is called by the transcript recovery system after a crash: PCM
/// checkpoints are encoded into `audio.mp4` in one pass; legacy AAC
/// checkpoints are stream-copy concatenated.
#[tauri::command]
pub async fn recover_audio_from_checkpoints(
    meeting_folder: String,
    sample_rate: u32,
) -> Result<AudioRecoveryStatus, String> {
    incremental_saver::recover_audio_from_checkpoints(meeting_folder, sample_rate).await
}

/// Clean up checkpoint files after successful recording or recovery.
/// This command is called by the frontend after successful save to clean up checkpoint files.
#[tauri::command]
pub async fn cleanup_checkpoints(meeting_folder: String) -> Result<(), String> {
    incremental_saver::cleanup_checkpoints(meeting_folder).await
}

/// Check if a meeting folder has audio checkpoint files.
/// Returns true if .checkpoints/ directory exists and contains .mp4 files.
#[tauri::command]
pub async fn has_audio_checkpoints(meeting_folder: String) -> Result<bool, String> {
    incremental_saver::has_audio_checkpoints(meeting_folder).await
}
