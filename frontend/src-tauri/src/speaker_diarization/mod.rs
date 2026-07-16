//! Speaker diarization layer.
//!
//! Sits behind the dual-VAD audio pipeline (see `audio::pipeline`): when a
//! speech segment is about to be transcribed, we extract a 512-dim CAM++
//! speaker embedding and assign it to a cluster (online, real-time) so the
//! transcription gets tagged with "Speaker 1", "Speaker 2", etc.
//!
//! Both mic AND system segments run through this layer when a diarizer is
//! loaded — in a speakers-in-a-room setup the mic captures every
//! participant, so clustering the mic stream separates those voices instead
//! of lumping them under the local user. The "Me" placeholder is used only
//! when no diarizer is loaded (speaker model not downloaded).
//!
//! ## How the local user gets labelled "Me" with a diarizer loaded
//!
//! Because mic segments are clustered rather than assumed to be the user, the
//! user's own voice would otherwise surface as "Speaker N". The fix is
//! enrollment (see [`enrollment`]): the user records a baseline of their own
//! voice in settings, and it's stored as an ordinary voice profile — flagged
//! `is_self` and named [`SELF_SPEAKER_LABEL`]. Nothing in the diarizer
//! special-cases it: [`SpeakerProfileMatcher`] recognizes it like any other
//! stored speaker, and [`Diarizer::process`] renders the matched profile's
//! name, which for that row is "Me".
//!
//! That's why the label lives in the profile's *name* rather than being
//! derived from the flag at match time: it needs no branch on any hot path,
//! self-attribution works on mic and system sources alike (a user dialled into
//! their own meeting still matches), and the flag stays what it should be —
//! the stable identity enrollment uses to find and replace the profile,
//! independent of what the row is called.
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
pub mod enrollment;
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

/// Default display label for the local user's own voice. Used as the initial
/// `name` on their enrolled voice profile (`is_self = 1`) and as the fallback
/// when they clear the custom label — enrollment lets the user rename it to
/// e.g. their own name (see `enrollment::self_label_or_default`). Also the
/// no-diarizer mic placeholder in
/// `audio::transcription::worker::default_speaker_for_source`; that placeholder
/// only applies with no speaker model loaded, which is exactly when no
/// enrollment (and so no custom label) can exist, so the two never disagree.
pub const SELF_SPEAKER_LABEL: &str = "Me";

/// Result of diarizing a single speech segment.
#[derive(Debug, Clone)]
pub struct DiarizationResult {
    /// Display label: a stored profile name when matched, else "Speaker N".
    /// The user's enrolled profile is named [`SELF_SPEAKER_LABEL`], so their
    /// own voice comes back as "Me" through the ordinary match path.
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
        // This is also the self-attribution path: the enrolled self profile is
        // just another entry in the matcher, named "Me".
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

    /// Detect speaker-turn boundaries within a single VAD segment and return
    /// the contiguous sub-ranges `[start, end)` (in samples) that each belong
    /// to one speaker. Returns a single whole-segment range when the audio is
    /// too short to split reliably or holds one speaker throughout.
    ///
    /// Works by embedding consecutive ~1s windows and cutting where adjacent
    /// voice embeddings diverge — this catches speakers who talk back-to-back
    /// with no silence gap, which VAD (silence-based) can't separate. The
    /// caller transcribes and labels each returned range independently.
    pub fn speaker_turns(&self, samples_16k: &[f32]) -> Vec<(usize, usize)> {
        /// 1s analysis window at 16 kHz — CAM++'s reliable minimum.
        const WIN: usize = 16_000;
        /// Don't attempt a split below 2s (can't hold two speakers reliably).
        const MIN_TOTAL: usize = 2 * WIN;
        /// Cosine similarity below this between adjacent windows => new speaker.
        const CHANGE_SIM: f32 = 0.5;

        let n = samples_16k.len();
        if n < MIN_TOTAL {
            return vec![(0, n)];
        }

        let bounds = window_bounds(n, WIN);
        if bounds.len() < 2 {
            return vec![(0, n)];
        }

        // Embedding is stateless per call; safe to run here. Windows that are
        // too short/quiet to embed come back None and never force a cut.
        let embeddings: Vec<Option<Vec<f32>>> = bounds
            .iter()
            .map(|&(a, b)| {
                self.embedder.embed(&samples_16k[a..b]).ok().map(|mut e| {
                    normalize(&mut e);
                    e
                })
            })
            .collect();

        turns_from_embeddings(&bounds, &embeddings, CHANGE_SIM)
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

/// Consecutive analysis-window `[start, end)` bounds over `n` samples. A short
/// trailing remainder (< half a window) is folded into the previous window so
/// we never embed a tiny, unreliable stub.
fn window_bounds(n: usize, win: usize) -> Vec<(usize, usize)> {
    let mut bounds: Vec<(usize, usize)> = Vec::new();
    let mut s = 0;
    while s < n {
        let e = (s + win).min(n);
        if e - s < win / 2 {
            match bounds.last_mut() {
                Some(last) => last.1 = n,
                None => bounds.push((s, n)),
            }
            break;
        }
        bounds.push((s, e));
        s = e;
    }
    bounds
}

/// Group windows into speaker-turn ranges, cutting where adjacent (already
/// L2-normalized) embeddings fall below `min_similarity`. Windows that failed
/// to embed (`None`) never introduce a cut. The result always covers
/// `[bounds[0].0, bounds.last().1)` contiguously with no gaps.
fn turns_from_embeddings(
    bounds: &[(usize, usize)],
    embeddings: &[Option<Vec<f32>>],
    min_similarity: f32,
) -> Vec<(usize, usize)> {
    if bounds.is_empty() {
        return Vec::new();
    }
    let mut turns = Vec::new();
    let mut start = 0usize;
    for i in 1..bounds.len() {
        let changed = match (&embeddings[i - 1], &embeddings[i]) {
            (Some(a), Some(b)) => cosine_normalized(a, b) < min_similarity,
            _ => false, // a window we couldn't embed can't establish a boundary
        };
        if changed {
            turns.push((bounds[start].0, bounds[i - 1].1));
            start = i;
        }
    }
    turns.push((bounds[start].0, bounds[bounds.len() - 1].1));
    turns
}

fn normalize(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-8 {
        let inv = 1.0 / norm;
        for x in v.iter_mut() {
            *x *= inv;
        }
    }
}

/// Cosine similarity of two already-normalized vectors (i.e. their dot product).
fn cosine_normalized(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod turn_tests {
    use super::*;

    #[test]
    fn window_bounds_folds_short_trailer() {
        // 2.4s @ 16k: two full 1s windows, 0.4s trailer folded into the second.
        let b = window_bounds(38_400, 16_000);
        assert_eq!(b, vec![(0, 16_000), (16_000, 38_400)]);
    }

    #[test]
    fn window_bounds_exact_multiple() {
        let b = window_bounds(32_000, 16_000);
        assert_eq!(b, vec![(0, 16_000), (16_000, 32_000)]);
    }

    #[test]
    fn single_speaker_stays_one_turn() {
        let bounds = vec![(0, 16_000), (16_000, 32_000), (32_000, 48_000)];
        let a = Some(vec![1.0, 0.0]);
        let embs = vec![a.clone(), a.clone(), a];
        assert_eq!(
            turns_from_embeddings(&bounds, &embs, 0.5),
            vec![(0, 48_000)]
        );
    }

    #[test]
    fn speaker_change_splits_and_covers_contiguously() {
        let bounds = vec![(0, 16_000), (16_000, 32_000), (32_000, 48_000)];
        // window 0,1 = speaker A; window 2 = speaker B (orthogonal => sim 0).
        let embs = vec![
            Some(vec![1.0, 0.0]),
            Some(vec![1.0, 0.0]),
            Some(vec![0.0, 1.0]),
        ];
        let turns = turns_from_embeddings(&bounds, &embs, 0.5);
        assert_eq!(turns, vec![(0, 32_000), (32_000, 48_000)]);
    }

    #[test]
    fn failed_embedding_does_not_cut() {
        let bounds = vec![(0, 16_000), (16_000, 32_000)];
        let embs = vec![Some(vec![1.0, 0.0]), None];
        assert_eq!(
            turns_from_embeddings(&bounds, &embs, 0.5),
            vec![(0, 32_000)]
        );
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
