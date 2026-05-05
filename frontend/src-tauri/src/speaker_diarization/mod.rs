//! Speaker diarization layer.
//!
//! Sits behind the dual-VAD audio pipeline (see `audio::pipeline`): when a
//! system-source speech segment is about to be transcribed, we extract a
//! 192-dim speaker embedding and assign it to a cluster (online, real-time)
//! so the transcription gets tagged with "Speaker 1", "Speaker 2", etc.
//! Mic-source segments bypass this layer — they're labeled "Me" directly.
//!
//! ## Lifecycle
//! - At app startup the model file is checked but not loaded (lazy).
//! - When recording starts and the model file is present, a [`Diarizer`] is
//!   built and stored in [`DIARIZER`]. It lives for the duration of the
//!   recording session and is dropped on stop, resetting cluster IDs.
//! - The transcription worker reads [`DIARIZER`] via [`current_diarizer`] and
//!   calls [`Diarizer::process`] for each system-source chunk.
//!
//! Phase 3 will swap the in-memory clusterer for one that consults stored
//! `voice_profiles` first (named-speaker recognition) and adds a 2-pass
//! refinement step when recording ends.

use once_cell::sync::Lazy;
use std::sync::{Arc, Mutex};

pub(crate) mod clusterer;
mod embedder;
pub mod model;
mod profile_matcher;
mod refinement;

pub mod commands;

pub use clusterer::OnlineSpeakerClusterer;
pub use embedder::SpeakerEmbedder;
pub use model::{default_model_path, model_download_url, model_filename, models_dir};
pub use profile_matcher::{ProfileMatch, SpeakerProfileMatcher, PROFILE_MATCH_THRESHOLD};
pub use refinement::{refine as refine_assignments, RefinedAssignment};

use anyhow::Result;

/// Default cosine-similarity threshold above which an incoming embedding is
/// merged into an existing cluster. Tuned for 3D-Speaker CAM++; values lower
/// than this risk merging different speakers, higher risk fragmenting a
/// single speaker into multiple "Speaker N" labels.
pub const DEFAULT_CLUSTER_THRESHOLD: f32 = 0.55;

/// Result of diarizing a single speech segment.
#[derive(Debug, Clone)]
pub struct DiarizationResult {
    /// Display label: a stored profile name when matched, else "Speaker N".
    pub label: String,
    /// Stored voice profile id when this segment matched a known speaker;
    /// `None` for in-session-only clusters.
    pub voice_profile_id: Option<String>,
}

/// Per-recording diarizer state. Holds the (shared, immutable) embedder, a
/// matcher that consults stored voice profiles, an in-session clusterer for
/// fallback labels, and a full embedding history used by 2-pass refinement
/// at recording stop.
pub struct Diarizer {
    embedder: Arc<SpeakerEmbedder>,
    profile_matcher: Option<Arc<SpeakerProfileMatcher>>,
    clusterer: Mutex<OnlineSpeakerClusterer>,
    history: Mutex<Vec<EmbeddingRecord>>,
}

#[derive(Debug, Clone)]
pub struct EmbeddingRecord {
    pub sequence_id: u64,
    pub embedding: Vec<f32>,
    /// Cluster id assigned by the in-session clusterer. Always populated,
    /// even when a profile match also fired (so refinement still has the
    /// cluster topology to work with).
    pub cluster_id: usize,
    /// Profile match (if any) — id and label captured at the time of
    /// processing so refinement and "promote to profile" can replay history
    /// without rerunning matching.
    pub voice_profile_id: Option<String>,
    pub label: String,
}

impl Diarizer {
    pub fn new(
        embedder: Arc<SpeakerEmbedder>,
        threshold: f32,
        profile_matcher: Option<Arc<SpeakerProfileMatcher>>,
    ) -> Self {
        Self {
            embedder,
            profile_matcher,
            clusterer: Mutex::new(OnlineSpeakerClusterer::new(threshold)),
            history: Mutex::new(Vec::new()),
        }
    }

    /// Embed `samples_16k`, try to match a stored profile, fall back to
    /// in-session clustering. Always records to history so Phase 3.5
    /// refinement (and "promote to profile") can replay it.
    pub fn process(&self, sequence_id: u64, samples_16k: &[f32]) -> Result<DiarizationResult> {
        let embedding = self.embedder.embed(samples_16k)?;

        // Always run the cluster step — we need the cluster_id in history
        // even when a profile match fires, so the user can later "promote
        // Speaker 2 to John" using the cluster's grouped embeddings.
        let cluster_id = {
            let mut clusterer = self
                .clusterer
                .lock()
                .map_err(|_| anyhow::anyhow!("speaker clusterer mutex poisoned"))?;
            clusterer.assign(embedding.clone())
        };

        // A stored-profile match takes precedence over the cluster label.
        let profile_match = self
            .profile_matcher
            .as_ref()
            .and_then(|m| m.search(&embedding));

        let (label, voice_profile_id) = match profile_match {
            Some(m) => (m.name, Some(m.profile_id)),
            None => {
                let clusterer = self
                    .clusterer
                    .lock()
                    .map_err(|_| anyhow::anyhow!("speaker clusterer mutex poisoned"))?;
                (clusterer.label_for(cluster_id), None)
            }
        };

        if let Ok(mut h) = self.history.lock() {
            h.push(EmbeddingRecord {
                sequence_id,
                embedding,
                cluster_id,
                voice_profile_id: voice_profile_id.clone(),
                label: label.clone(),
            });
        }

        Ok(DiarizationResult {
            label,
            voice_profile_id,
        })
    }

    /// Snapshot of all embeddings produced this session.
    pub fn export_history(&self) -> Vec<EmbeddingRecord> {
        self.history
            .lock()
            .map(|h| h.clone())
            .unwrap_or_default()
    }

    /// Embeddings that landed in `cluster_id` this session. Used by
    /// `promote_speaker_to_profile` to compute a centroid.
    pub fn embeddings_for_cluster(&self, cluster_id: usize) -> Vec<Vec<f32>> {
        self.history
            .lock()
            .map(|h| {
                h.iter()
                    .filter(|r| r.cluster_id == cluster_id)
                    .map(|r| r.embedding.clone())
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// Process-wide diarizer slot. Set by `start_recording` (when the model is
/// ready), cleared by `stop_recording`. The transcription worker reads this
/// to decide whether system-source chunks get clustered or fall back to the
/// "Speaker" placeholder.
static DIARIZER: Lazy<Mutex<Option<Arc<Diarizer>>>> = Lazy::new(|| Mutex::new(None));

pub fn set_current_diarizer(diarizer: Option<Arc<Diarizer>>) {
    if let Ok(mut slot) = DIARIZER.lock() {
        *slot = diarizer;
    }
}

pub fn current_diarizer() -> Option<Arc<Diarizer>> {
    DIARIZER.lock().ok().and_then(|s| s.clone())
}
