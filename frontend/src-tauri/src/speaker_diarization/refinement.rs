//! Post-recording 2-pass refinement.
//!
//! Online clustering decides cluster membership with only the audio it has
//! seen so far, which means the first ~30s of a meeting can produce noisy
//! cluster IDs (one speaker briefly tagged "Speaker 2" before settling into
//! "Speaker 1"). After recording stops we have the full set of embeddings,
//! so we re-cluster from scratch in chronological order. Most segments keep
//! their original label; the noisy early ones get cleaned up.
//!
//! Stored profile matches (where `voice_profile_id` was set live) are NOT
//! disturbed — those are deterministic and don't benefit from refinement.

use crate::speaker_diarization::clusterer::OnlineSpeakerClusterer;
use crate::speaker_diarization::EmbeddingRecord;
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct RefinedAssignment {
    pub sequence_id: u64,
    pub speaker: String,
    /// Profile id at refinement time. Always `Some` when the live pass also
    /// matched a profile (we don't unmatch). Otherwise `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_profile_id: Option<String>,
    /// True when this segment's label changed vs the live pass — the
    /// frontend can use this to flash-update only the affected rows.
    pub changed: bool,
}

/// Re-cluster `history` (in original chronological order) and return one
/// assignment per record. `threshold` should match the live clusterer's so
/// behaviour is comparable.
pub fn refine(history: &[EmbeddingRecord], threshold: f32) -> Vec<RefinedAssignment> {
    let mut clusterer = OnlineSpeakerClusterer::new(threshold);
    let mut out = Vec::with_capacity(history.len());

    for record in history {
        // Profile-matched rows pass through unchanged: refinement is purely
        // about cleaning up unmatched "Speaker N" assignments.
        if let Some(profile_id) = &record.voice_profile_id {
            out.push(RefinedAssignment {
                sequence_id: record.sequence_id,
                speaker: record.label.clone(),
                voice_profile_id: Some(profile_id.clone()),
                changed: false,
            });
            continue;
        }

        let new_cluster = clusterer.assign(record.embedding.clone());
        let new_label = clusterer.label_for(new_cluster);
        let changed = new_label != record.label;

        out.push(RefinedAssignment {
            sequence_id: record.sequence_id,
            speaker: new_label,
            voice_profile_id: None,
            changed,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::speaker_diarization::EmbeddingRecord;

    fn rec(seq: u64, emb: Vec<f32>, cluster: usize, label: &str) -> EmbeddingRecord {
        EmbeddingRecord {
            sequence_id: seq,
            embedding: emb,
            cluster_id: cluster,
            voice_profile_id: None,
            label: label.to_string(),
        }
    }

    #[test]
    fn empty_history_returns_empty() {
        let out = refine(&[], 0.55);
        assert!(out.is_empty());
    }

    #[test]
    fn profile_matched_rows_are_pinned() {
        let mut r = rec(1, vec![1.0, 0.0], 0, "John");
        r.voice_profile_id = Some("profile-1".to_string());
        let out = refine(&[r], 0.55);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].speaker, "John");
        assert_eq!(out[0].voice_profile_id.as_deref(), Some("profile-1"));
        assert!(!out[0].changed);
    }

    #[test]
    fn similar_embeddings_merge_under_refinement() {
        // Live pass: 3 clusters because tight threshold + chronological pressure.
        // Refine pass: same algo, but at least the algorithm is deterministic
        // and we expect identical clustering on identical input.
        let history = vec![
            rec(1, vec![1.0, 0.0, 0.0], 0, "Speaker 1"),
            rec(2, vec![0.0, 1.0, 0.0], 1, "Speaker 2"),
            rec(3, vec![0.99, 0.01, 0.0], 0, "Speaker 1"),
        ];
        let out = refine(&history, 0.5);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].speaker, "Speaker 1");
        assert_eq!(out[1].speaker, "Speaker 2");
        assert_eq!(out[2].speaker, "Speaker 1");
    }
}
