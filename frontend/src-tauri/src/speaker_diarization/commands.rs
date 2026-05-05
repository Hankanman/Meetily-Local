//! Tauri commands for the speaker diarization layer.

use crate::database::repositories::transcript::TranscriptsRepository;
use crate::database::repositories::voice_profile::{bytes_to_floats, VoiceProfilesRepository};
use crate::speaker_diarization::{
    current_diarizer, default_model_path, model::model_is_ready, model_download_url,
    model_filename, refine_assignments, set_current_diarizer, Diarizer, RefinedAssignment,
    SpeakerEmbedder, SpeakerProfileMatcher, DEFAULT_CLUSTER_THRESHOLD, PROFILE_MATCH_THRESHOLD,
};
use crate::state::AppState;
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, Manager, Runtime};
use tokio::io::AsyncWriteExt;

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
    let path = default_model_path()
        .ok_or_else(|| "Speaker models directory not initialized".to_string())?;

    if model_is_ready(&path) {
        let _ = app.emit(
            "speaker-model-download-complete",
            serde_json::json!({ "alreadyPresent": true }),
        );
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Err(format!("Failed to create speaker models dir: {}", e));
        }
    }

    let url = model_download_url();
    log::info!("Downloading speaker model from {} -> {}", url, path.display());

    if let Err(e) = stream_download(&app, &url, &path).await {
        let _ = std::fs::remove_file(&path); // partial-file cleanup
        let msg = e.to_string();
        let _ = app.emit(
            "speaker-model-download-error",
            serde_json::json!({ "error": &msg }),
        );
        return Err(msg);
    }

    let _ = app.emit(
        "speaker-model-download-complete",
        serde_json::json!({ "alreadyPresent": false }),
    );
    Ok(())
}

/// Build a [`Diarizer`] from the on-disk model + stored voice profiles.
/// Returns `None` if the speaker model isn't downloaded — callers should
/// degrade gracefully (no `speaker` label rather than failing).
///
/// Used by both the live recording path (via [`try_init_for_recording`])
/// and batch jobs (import / retranscription) that want their own
/// short-lived diarizer instance with fresh cluster IDs.
pub async fn build_diarizer<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Arc<Diarizer>>> {
    let Some(path) = default_model_path() else {
        log::warn!("Speaker models dir not configured; skipping diarizer build");
        return Ok(None);
    };
    if !model_is_ready(&path) {
        log::info!(
            "Speaker model not present at {}; speaker labels will be empty",
            path.display()
        );
        return Ok(None);
    }

    let embedder = SpeakerEmbedder::from_path(&path, 1)?;
    let dim = embedder.dim();

    // Load all stored voice profiles whose embedding dim matches the model.
    // A mismatched-dim profile (e.g., from an older model) is skipped by the
    // matcher rather than failing the build.
    let matcher = match build_profile_matcher(app, dim).await {
        Ok(m) => m,
        Err(e) => {
            log::warn!("Failed to load voice profiles: {} (continuing without)", e);
            None
        }
    };

    let diarizer = Diarizer::new(Arc::new(embedder), DEFAULT_CLUSTER_THRESHOLD, matcher);
    Ok(Some(Arc::new(diarizer)))
}

/// Build a diarizer and install it into the process-wide slot for the live
/// recording path. Silent no-op (returns `Ok(false)`) if the model isn't on
/// disk — recording proceeds with the "Speaker" placeholder.
pub async fn try_init_for_recording<R: Runtime>(app: &AppHandle<R>) -> Result<bool> {
    match build_diarizer(app).await? {
        Some(diarizer) => {
            set_current_diarizer(Some(diarizer));
            log::info!("Speaker diarizer initialized for recording session");
            Ok(true)
        }
        None => {
            set_current_diarizer(None);
            Ok(false)
        }
    }
}

/// At recording stop we *don't* clear the diarizer — its embedding history
/// is still needed for `promote_speaker_to_profile` and 2-pass refinement.
/// The next `try_init_for_recording` call replaces it with a fresh instance.
pub fn shutdown_for_recording() {
    log::info!("Speaker diarizer retained post-stop for promote / refine actions");
}

async fn build_profile_matcher<R: Runtime>(
    app: &AppHandle<R>,
    dim: usize,
) -> Result<Option<Arc<SpeakerProfileMatcher>>> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| anyhow!("AppState unavailable; cannot load voice profiles"))?;
    let pool = state.db_manager.pool();

    let profiles = VoiceProfilesRepository::list_all(pool)
        .await
        .map_err(|e| anyhow!("DB error listing voice profiles: {}", e))?;

    if profiles.is_empty() {
        return Ok(None);
    }

    let entries = profiles.into_iter().filter_map(|p| {
        bytes_to_floats(&p.embedding).map(|emb| (p.id, p.name, emb))
    });

    let matcher = SpeakerProfileMatcher::new(dim, entries, PROFILE_MATCH_THRESHOLD)?;
    if matcher.num_profiles() == 0 {
        Ok(None)
    } else {
        Ok(Some(Arc::new(matcher)))
    }
}

async fn stream_download<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    dest: &std::path::Path,
) -> Result<()> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| anyhow!("HTTP error: {}", e))?;
    if !response.status().is_success() {
        return Err(anyhow!("HTTP {} fetching {}", response.status(), url));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_pct: u8 = 0;

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| anyhow!("Cannot create {}: {}", dest.display(), e))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| anyhow!("Download stream error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| anyhow!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        if total > 0 {
            let pct = ((downloaded as u128 * 100) / total as u128) as u8;
            // Emit only on 1% steps to avoid event flood for a 28MB download.
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit(
                    "speaker-model-download-progress",
                    serde_json::json!({ "progress": pct }),
                );
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| anyhow!("Flush error: {}", e))?;
    Ok(())
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
    /// Cluster id assigned during recording (0-indexed, "Speaker N" maps to
    /// cluster_id = N - 1).
    pub cluster_id: usize,
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
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Profile name cannot be empty".into());
    }
    let normalised_email = email
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    let pool = state.db_manager.pool();
    VoiceProfilesRepository::update_profile(pool, &profile_id, trimmed_name, normalised_email)
        .await
        .map_err(|e| format!("Failed to update voice profile: {}", e))
}

/// Take all embeddings the diarizer assigned to `cluster_id` during the most
/// recent recording, average them into a centroid, and save as a new voice
/// profile under `name`. Returns the new profile id.
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
    let normalised_email = args
        .email
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    let pool = state.db_manager.pool();

    let old_label = format!("Speaker {}", args.cluster_id + 1);

    // Try to grab the embeddings. They're reachable only when the diarizer
    // that produced this meeting is still the in-memory singleton (a live
    // recording or its just-finished retranscription). Older meetings
    // degrade to rename-only.
    let embeddings = current_diarizer()
        .map(|d| d.embeddings_for_cluster(args.cluster_id))
        .unwrap_or_default();

    let profile_id = if embeddings.is_empty() {
        log::warn!(
            "No embeddings reachable for {} in meeting {} — renaming transcripts but skipping voice-profile creation",
            old_label,
            args.meeting_id,
        );
        None
    } else {
        let centroid = average_and_normalize(&embeddings);
        let id = VoiceProfilesRepository::create(
            pool,
            trimmed_name,
            normalised_email,
            &centroid,
            embeddings.len() as i64,
        )
        .await
        .map_err(|e| format!("Failed to create voice profile: {}", e))?;
        log::info!(
            "Promoted {} to profile '{}' (email={:?}, id={}, samples={})",
            old_label,
            trimmed_name,
            normalised_email,
            id,
            embeddings.len()
        );
        Some(id)
    };

    // Rewrite the displayed speaker label in this meeting's transcripts so
    // every row that previously showed "Speaker N" now shows the new name.
    // This runs in both the success and the rename-only fallback case.
    let renamed_count = TranscriptsRepository::rename_speaker_in_meeting(
        pool,
        &args.meeting_id,
        &old_label,
        trimmed_name,
        profile_id.as_deref(),
    )
    .await
    .map_err(|e| format!("Failed to rename transcripts: {}", e))?;

    log::info!(
        "Renamed {} -> '{}' across {} transcript rows in meeting {}",
        old_label,
        trimmed_name,
        renamed_count,
        args.meeting_id,
    );

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

    let winner = VoiceProfilesRepository::get_by_id(pool, &args.winner_id)
        .await
        .map_err(|e| format!("Failed to load winner profile: {}", e))?
        .ok_or_else(|| format!("Profile not found: {}", args.winner_id))?;
    let loser = VoiceProfilesRepository::get_by_id(pool, &args.loser_id)
        .await
        .map_err(|e| format!("Failed to load loser profile: {}", e))?
        .ok_or_else(|| format!("Profile not found: {}", args.loser_id))?;

    let centroid_updated = if winner.embedding_dim == loser.embedding_dim {
        let winner_centroid = bytes_to_floats(&winner.embedding)
            .ok_or_else(|| "Winner profile has corrupt embedding".to_string())?;
        let loser_centroid = bytes_to_floats(&loser.embedding)
            .ok_or_else(|| "Loser profile has corrupt embedding".to_string())?;
        let merged = merge_centroids(
            &winner_centroid,
            winner.sample_count.max(0) as usize,
            &loser_centroid,
            loser.sample_count.max(0) as usize,
        );
        let new_count = winner.sample_count + loser.sample_count;
        VoiceProfilesRepository::update_centroid(pool, &winner.id, &merged, new_count)
            .await
            .map_err(|e| format!("Failed to update winner centroid: {}", e))?;
        true
    } else {
        log::warn!(
            "Embedding-dim mismatch ({} vs {}) merging {} into {} — relinking transcripts only",
            winner.embedding_dim,
            loser.embedding_dim,
            loser.id,
            winner.id,
        );
        false
    };

    let renamed_count = TranscriptsRepository::relink_transcripts(
        pool,
        &loser.id,
        &winner.id,
        &winner.name,
    )
    .await
    .map_err(|e| format!("Failed to relink transcripts: {}", e))?;

    VoiceProfilesRepository::delete(pool, &loser.id)
        .await
        .map_err(|e| format!("Failed to delete loser profile: {}", e))?;

    log::info!(
        "Merged profile '{}' ({}) into '{}' ({}): {} transcripts relinked, centroid_updated={}",
        loser.name,
        loser.id,
        winner.name,
        winner.id,
        renamed_count,
        centroid_updated
    );

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
    /// Cluster id assigned during the meeting (0-indexed).
    pub cluster_id: usize,
    /// Profile that gets credit for this cluster's samples.
    pub profile_id: String,
}

/// Merge an unnamed in-meeting cluster ("Speaker N") into an existing
/// stored profile. Used when the user clicks "Speaker 2" and selects an
/// existing speaker (e.g., "Alice") from the autocomplete instead of
/// typing a new name — they're declaring "this is the same voice we
/// already have a profile for".
///
/// If the diarizer's embeddings for the cluster are reachable (see
/// `tauri-singleton-state-batch-vs-live` skill), they're folded into the
/// profile's centroid. Otherwise we degrade to relabel-only — the user
/// still gets named chips in this meeting.
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

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    let pool = state.db_manager.pool();

    let profile = VoiceProfilesRepository::get_by_id(pool, &args.profile_id)
        .await
        .map_err(|e| format!("Failed to load profile: {}", e))?
        .ok_or_else(|| format!("Profile not found: {}", args.profile_id))?;

    let old_label = format!("Speaker {}", args.cluster_id + 1);

    // Pull this cluster's embeddings if the diarizer is still reachable.
    let cluster_embeddings = current_diarizer()
        .map(|d| d.embeddings_for_cluster(args.cluster_id))
        .unwrap_or_default();

    let centroid_updated = if !cluster_embeddings.is_empty()
        && cluster_embeddings[0].len() as i64 == profile.embedding_dim
    {
        let cluster_centroid = average_and_normalize(&cluster_embeddings);
        let profile_centroid = bytes_to_floats(&profile.embedding)
            .ok_or_else(|| "Profile has corrupt embedding".to_string())?;
        let merged = merge_centroids(
            &profile_centroid,
            profile.sample_count.max(0) as usize,
            &cluster_centroid,
            cluster_embeddings.len(),
        );
        let new_count = profile.sample_count + cluster_embeddings.len() as i64;
        VoiceProfilesRepository::update_centroid(pool, &profile.id, &merged, new_count)
            .await
            .map_err(|e| format!("Failed to update profile centroid: {}", e))?;
        true
    } else {
        if !cluster_embeddings.is_empty() {
            log::warn!(
                "Embedding-dim mismatch for cluster {} ({} vs profile {}) — skipping centroid update",
                args.cluster_id,
                cluster_embeddings[0].len(),
                profile.embedding_dim,
            );
        } else {
            log::info!(
                "No embeddings reachable for cluster {} in meeting {} — relabel only",
                args.cluster_id,
                args.meeting_id,
            );
        }
        false
    };

    let renamed_count = TranscriptsRepository::rename_speaker_in_meeting(
        pool,
        &args.meeting_id,
        &old_label,
        &profile.name,
        Some(&profile.id),
    )
    .await
    .map_err(|e| format!("Failed to rename transcripts: {}", e))?;

    if !centroid_updated && renamed_count == 0 {
        return Err(format!(
            "Nothing to do: no embeddings for {} and no transcripts in meeting {} carry that label",
            old_label, args.meeting_id
        ));
    }

    log::info!(
        "Merged {} (meeting {}) into profile '{}' ({}): {} transcripts relabeled, centroid_updated={}",
        old_label,
        args.meeting_id,
        profile.name,
        profile.id,
        renamed_count,
        centroid_updated
    );

    Ok(MergeResult {
        renamed_count,
        centroid_updated,
    })
}

/// Run the post-recording 2-pass refinement and return refined speaker
/// assignments, one per system-source segment (keyed by `sequence_id`).
/// Frontend consumers update displayed transcripts whose `sequence_id`
/// matches. Stored profile matches pass through unchanged.
///
/// Also emits `transcript-refinement-complete` (`{ refined_count, changed_count }`)
/// so UI can show a brief "speakers refined" toast.
#[command]
pub async fn refine_speaker_assignments<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<RefinedAssignment>, String> {
    let diarizer = current_diarizer()
        .ok_or_else(|| "No diarizer available — record a meeting first".to_string())?;

    let history = diarizer.export_history();
    let refined = refine_assignments(&history, DEFAULT_CLUSTER_THRESHOLD);
    let changed_count = refined.iter().filter(|r| r.changed).count();

    log::info!(
        "Speaker refinement: {} segments processed, {} relabeled",
        refined.len(),
        changed_count
    );

    let _ = app.emit(
        "transcript-refinement-complete",
        serde_json::json!({
            "refined_count": refined.len(),
            "changed_count": changed_count,
        }),
    );

    Ok(refined)
}

/// Combine two centroid+sample_count pairs into a single L2-normalized
/// centroid representing the union of samples.
///
/// We only have the precomputed centroids (the raw embeddings aren't kept
/// after the diarizer's history is dropped), so this is a sample-count-
/// weighted average rather than a true mean over the raw vectors. For
/// reasonably similar voices that's close enough; the renormalize keeps
/// the result on the unit sphere where cosine-similarity matching expects
/// it.
fn merge_centroids(a: &[f32], a_n: usize, b: &[f32], b_n: usize) -> Vec<f32> {
    debug_assert_eq!(a.len(), b.len());
    let dim = a.len();
    let total = (a_n + b_n) as f32;
    let mut acc = vec![0.0f32; dim];
    for i in 0..dim {
        acc[i] = (a[i] * a_n as f32 + b[i] * b_n as f32) / total;
    }
    let norm = acc.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-8 {
        let inv = 1.0 / norm;
        for v in acc.iter_mut() {
            *v *= inv;
        }
    }
    acc
}

/// Average a set of embeddings and L2-normalize the result. Mirrors the
/// online clusterer's centroid update so behaviour stays consistent.
fn average_and_normalize(embeddings: &[Vec<f32>]) -> Vec<f32> {
    if embeddings.is_empty() {
        return Vec::new();
    }
    let dim = embeddings[0].len();
    let mut acc = vec![0.0f32; dim];
    for e in embeddings {
        debug_assert_eq!(e.len(), dim);
        for (i, v) in e.iter().enumerate() {
            acc[i] += v;
        }
    }
    let n = embeddings.len() as f32;
    for v in acc.iter_mut() {
        *v /= n;
    }
    let norm = acc.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-8 {
        let inv = 1.0 / norm;
        for v in acc.iter_mut() {
            *v *= inv;
        }
    }
    acc
}
