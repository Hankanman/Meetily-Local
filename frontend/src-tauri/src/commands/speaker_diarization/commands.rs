//! Tauri commands for the speaker diarization layer.

use crate::database::repositories::voice_profile::VoiceProfilesRepository;
use crate::speaker_diarization::model::{default_model_path, model_filename, model_is_ready};
use crate::speaker_diarization::model_download_url;
use crate::speaker_diarization::service;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager, Runtime};

// Re-export core lifecycle functions so existing
// `speaker_diarization::commands::build_diarizer` / `try_init_for_recording` /
// `refine_and_persist` / `shutdown_for_recording` paths (used across the
// audio module) keep working unchanged.
pub use service::{build_diarizer, refine_and_persist, shutdown_for_recording, try_init_for_recording};

#[derive(Debug, Serialize)]
pub struct SpeakerModelStatus {
    pub model_filename: String,
    pub model_path: Option<String>,
    pub is_ready: bool,
    pub download_url: String,
}

/// Returns whether the speaker model file exists on disk along with its
/// resolved path. The frontend uses this on settings screens and at the
/// start of each recording to decide whether diarization can run.
#[command]
pub async fn speaker_model_status() -> Result<SpeakerModelStatus, String> {
    let path = default_model_path();
    let is_ready = path.as_deref().map(model_is_ready).unwrap_or(false);
    Ok(SpeakerModelStatus {
        model_filename: model_filename().to_string(),
        model_path: path.map(|p| p.to_string_lossy().into_owned()),
        is_ready,
        download_url: model_download_url(),
    })
}

/// Download the speaker model. Emits `speaker-model-download-progress`
/// (`{ progress: 0..100 }`) while running, then `speaker-model-download-complete`
/// or `speaker-model-download-error` at the end. Idempotent: if the file is
/// already present and non-empty, returns immediately.
#[command]
pub async fn speaker_model_download<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    service::download_speaker_model(crate::tauri_events::shared_sink(&app)).await
}

/// Ensure the pyannote segmentation model (used only for the accurate
/// *offline* diarization pass on Import — see `speaker_diarization::offline`
/// and `audio::import::run_import`) is present on disk, downloading it on
/// demand if missing, and return its resolved path.
///
/// Unlike the VAD and speaker-embedding models, this one is deliberately
/// **not** fetched at app startup (see `lib.rs::ensure_required_models_downloaded`)
/// — it's only needed when a user has `offline_diarization_on_import` on and
/// imports a file worth running it on, so the ~5.7MB download is deferred to
/// that first use instead of being paid by every install/launch.
#[command]
pub async fn ensure_pyannote_segmentation_model() -> Result<String, String> {
    service::ensure_pyannote_segmentation_model().await
}

// ──────────────────────────────────────────────────────────────────────────
// Voice profile CRUD + promote-from-cluster commands
// ──────────────────────────────────────────────────────────────────────────

/// Wire-shaped voice profile. The raw embedding bytes are intentionally not
/// exposed to the frontend; this DTO is for listing/management UI only.
#[derive(Debug, Serialize)]
pub struct VoiceProfileDto {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub embedding_dim: i64,
    pub sample_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct PromoteSpeakerArgs {
    /// The displayed label being promoted (e.g. "Speaker 2"). Used both to
    /// look up the diarizer's embeddings for that label and to rewrite the
    /// meeting's transcript rows. The label — not any internal cluster id —
    /// is the identifier, because post-recording refinement renumbers labels
    /// independently of the live clusterer's ids.
    pub speaker_label: String,
    pub name: String,
    /// Optional contact email — frontend may collect it in the same dialog
    /// that captures the name. `None` / empty string leaves it unset.
    #[serde(default)]
    pub email: Option<String>,
    /// Meeting whose transcripts should have their `speaker` label rewritten
    /// from "Speaker N" to the new name. Required because cluster numbering
    /// is per-meeting — a "Speaker 1" rename without a meeting scope would
    /// mis-attribute speech in other meetings.
    pub meeting_id: String,
}

/// Result of `promote_speaker_to_profile`. `profile_id` is `None` when the
/// embeddings for this cluster aren't reachable (most often: viewing an old
/// meeting whose diarizer state has been dropped) — in that case we still
/// rename the speaker in the meeting's transcripts so the user gets the
/// named chip back, but no voice profile is created and future meetings
/// won't auto-recognise this speaker.
#[derive(Debug, Serialize)]
pub struct PromoteSpeakerResult {
    pub profile_id: Option<String>,
    pub renamed_count: u64,
}

#[command]
pub async fn list_voice_profiles<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<VoiceProfileDto>, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    let pool = state.db_manager.pool();

    let profiles = VoiceProfilesRepository::list_all(pool)
        .await
        .map_err(|e| format!("Failed to list voice profiles: {}", e))?;

    Ok(profiles
        .into_iter()
        .map(|p| VoiceProfileDto {
            id: p.id,
            name: p.name,
            email: p.email,
            embedding_dim: p.embedding_dim,
            sample_count: p.sample_count,
            created_at: p.created_at,
            updated_at: p.updated_at,
        })
        .collect())
}

#[command]
pub async fn delete_voice_profile<R: Runtime>(
    app: AppHandle<R>,
    profile_id: String,
) -> Result<bool, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    let pool = state.db_manager.pool();
    VoiceProfilesRepository::delete(pool, &profile_id)
        .await
        .map_err(|e| format!("Failed to delete voice profile: {}", e))
}

/// Update the display fields (name and optional email) of a stored voice
/// profile. Empty / whitespace-only `email` is normalised to `None`.
#[command]
pub async fn update_voice_profile<R: Runtime>(
    app: AppHandle<R>,
    profile_id: String,
    name: String,
    email: Option<String>,
) -> Result<bool, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    let pool = state.db_manager.pool();
    VoiceProfilesRepository::update_profile(pool, &profile_id, &name, email.as_deref())
        .await
        .map_err(|e| format!("Failed to update voice profile: {}", e))
}

/// Take all embeddings currently carrying `speaker_label` in the diarizer's
/// history for the most recent recording, average them into a centroid, and
/// save as a new voice profile under `name`. Returns the new profile id.
///
/// Typical UX: after a meeting the user sees "Speaker 2" said something —
/// they click "name this" → enter "Bob" → this command runs. Future meetings
/// will then auto-tag Bob's voice.
#[command]
pub async fn promote_speaker_to_profile<R: Runtime>(
    app: AppHandle<R>,
    args: PromoteSpeakerArgs,
) -> Result<PromoteSpeakerResult, String> {
    let trimmed_name = args.name.trim();
    if trimmed_name.is_empty() {
        return Err("Profile name cannot be empty".into());
    }
    if args.meeting_id.trim().is_empty() {
        return Err("meeting_id is required".into());
    }
    let old_label = args.speaker_label.trim().to_string();
    if old_label.is_empty() {
        return Err("speaker_label is required".into());
    }
    let normalised_email = args
        .email
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    let pool = state.db_manager.pool();

    let (profile_id, renamed_count) = service::promote_speaker_to_profile_core(
        pool,
        &old_label,
        trimmed_name,
        normalised_email,
        &args.meeting_id,
    )
    .await?;

    if profile_id.is_none() && renamed_count == 0 {
        return Err(format!(
            "Nothing to do: no embeddings reachable for {} and no transcripts in meeting {} carry that label",
            old_label, args.meeting_id
        ));
    }

    Ok(PromoteSpeakerResult {
        profile_id,
        renamed_count,
    })
}

#[derive(Debug, Deserialize)]
pub struct MergeProfilesArgs {
    /// Profile that survives the merge (keeps its id, name, email).
    pub winner_id: String,
    /// Profile that gets folded into the winner and then deleted.
    pub loser_id: String,
}

/// Result of any merge operation. `renamed_count` is the number of
/// transcript rows whose displayed `speaker` label and/or
/// `voice_profile_id` were rewritten.
#[derive(Debug, Serialize)]
pub struct MergeResult {
    pub renamed_count: u64,
    /// True if the winner profile's centroid was rebuilt from the merged
    /// samples; false in the rare degraded path where dimensions didn't
    /// match (e.g. embedding model change between sessions) and we fell
    /// back to relinking transcripts only.
    pub centroid_updated: bool,
}

/// Merge two stored voice profiles into one. Used when the model created
/// duplicate profiles for the same person across meetings (e.g., "Bob"
/// from Tuesday and "Bob" from Friday became separate ids).
///
/// Combines centroids weighted by `sample_count`, then re-points every
/// transcript referencing the loser to the winner and rewrites the
/// displayed `speaker` text. The loser profile is deleted in the same
/// transaction so the operation is atomic from the frontend's perspective.
#[command]
pub async fn merge_voice_profiles<R: Runtime>(
    app: AppHandle<R>,
    args: MergeProfilesArgs,
) -> Result<MergeResult, String> {
    if args.winner_id == args.loser_id {
        return Err("Cannot merge a profile into itself".into());
    }

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    let pool = state.db_manager.pool();

    let (renamed_count, centroid_updated) =
        service::merge_voice_profiles_core(pool, &args.winner_id, &args.loser_id).await?;

    Ok(MergeResult {
        renamed_count,
        centroid_updated,
    })
}

#[derive(Debug, Deserialize)]
pub struct MergeClusterArgs {
    /// Meeting whose "Speaker N" labels should be rewritten to the
    /// existing profile's name.
    pub meeting_id: String,
    /// The displayed label being merged (e.g. "Speaker 2"); see
    /// [`PromoteSpeakerArgs::speaker_label`] for why the label is the
    /// identifier.
    pub speaker_label: String,
    /// Profile that gets credit for this cluster's samples.
    pub profile_id: String,
}

/// Merge an unnamed in-meeting cluster ("Speaker N") into an existing
/// stored profile. Used when the user clicks "Speaker 2" and selects an
/// existing speaker (e.g., "Alice") from the autocomplete instead of
/// typing a new name — they're declaring "this is the same voice we
/// already have a profile for".
///
/// If the diarizer's embeddings for the cluster are reachable, they're
/// folded into the profile's centroid. Otherwise we degrade to
/// relabel-only — the user still gets named chips in this meeting.
#[command]
pub async fn merge_cluster_into_profile<R: Runtime>(
    app: AppHandle<R>,
    args: MergeClusterArgs,
) -> Result<MergeResult, String> {
    if args.meeting_id.trim().is_empty() {
        return Err("meeting_id is required".into());
    }
    if args.profile_id.trim().is_empty() {
        return Err("profile_id is required".into());
    }
    let old_label = args.speaker_label.trim().to_string();
    if old_label.is_empty() {
        return Err("speaker_label is required".into());
    }

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    let pool = state.db_manager.pool();

    let (renamed_count, centroid_updated) = service::merge_cluster_into_profile_core(
        pool,
        &args.meeting_id,
        &old_label,
        &args.profile_id,
    )
    .await?;

    if !centroid_updated && renamed_count == 0 {
        return Err(format!(
            "Nothing to do: no embeddings for {} and no transcripts in meeting {} carry that label",
            old_label, args.meeting_id
        ));
    }

    Ok(MergeResult {
        renamed_count,
        centroid_updated,
    })
}
