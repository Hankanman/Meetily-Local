//! Offline (batch) speaker diarization via sherpa-onnx.
//!
//! Unlike the online cosine clusterer (which greedily seeds a new speaker
//! whenever a snippet dips below a similarity threshold, and so over-counts),
//! this runs pyannote segmentation + speaker embeddings + global clustering
//! over the *entire* recording at once. It can be told the exact number of
//! speakers (`num_speakers`) for an exact result, or auto-estimate.
//!
//! Requires the whole audio buffer, so it only runs on Import / re-diarize,
//! never live. Input must be 16 kHz mono f32 (what the import path produces).

use std::path::Path;

use anyhow::{anyhow, Result};
use sherpa_onnx::{
    FastClusteringConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
    OfflineSpeakerSegmentationModelConfig, OfflineSpeakerSegmentationPyannoteModelConfig,
    SpeakerEmbeddingExtractorConfig,
};

/// A diarized speaker turn: `[start, end)` seconds → 0-based speaker index.
#[derive(Debug, Clone, Copy)]
pub struct SpeakerTurn {
    pub start: f32,
    pub end: f32,
    pub speaker: i32,
}

/// Run offline diarization on 16 kHz mono `samples`.
///
/// `num_speakers > 0` forces exactly that many clusters; `<= 0` auto-estimates.
pub fn diarize_offline(
    samples: &[f32],
    segmentation_model: &Path,
    embedding_model: &Path,
    num_speakers: i32,
    num_threads: i32,
) -> Result<Vec<SpeakerTurn>> {
    if !segmentation_model.exists() {
        return Err(anyhow!(
            "Pyannote segmentation model missing at {}",
            segmentation_model.display()
        ));
    }
    if !embedding_model.exists() {
        return Err(anyhow!(
            "Speaker embedding model missing at {}",
            embedding_model.display()
        ));
    }

    let config = OfflineSpeakerDiarizationConfig {
        segmentation: OfflineSpeakerSegmentationModelConfig {
            pyannote: OfflineSpeakerSegmentationPyannoteModelConfig {
                model: Some(segmentation_model.to_string_lossy().into_owned()),
            },
            num_threads,
            debug: false,
            provider: Some("cpu".to_string()),
        },
        embedding: SpeakerEmbeddingExtractorConfig {
            model: Some(embedding_model.to_string_lossy().into_owned()),
            num_threads,
            debug: false,
            provider: Some("cpu".to_string()),
        },
        clustering: FastClusteringConfig {
            num_clusters: if num_speakers > 0 { num_speakers } else { -1 },
            threshold: 0.5,
        },
        min_duration_on: 0.3,
        min_duration_off: 0.5,
    };

    let sd = OfflineSpeakerDiarization::create(&config)
        .ok_or_else(|| anyhow!("Failed to create OfflineSpeakerDiarization"))?;

    let result = sd
        .process(samples)
        .ok_or_else(|| anyhow!("Offline diarization returned no result"))?;

    let turns: Vec<SpeakerTurn> = result
        .sort_by_start_time()
        .into_iter()
        .map(|s| SpeakerTurn {
            start: s.start,
            end: s.end,
            speaker: s.speaker,
        })
        .collect();

    log::info!(
        "Offline diarization: {} turns across {} speaker(s) (requested={})",
        turns.len(),
        result.num_speakers(),
        num_speakers
    );

    Ok(turns)
}

/// Label a transcript segment `[start_s, end_s]` with the speaker whose turn
/// overlaps it the most. Returns e.g. `"Speaker 1"`, or `None` if no overlap.
pub fn speaker_for_range(turns: &[SpeakerTurn], start_s: f32, end_s: f32) -> Option<String> {
    let mut best: Option<(i32, f32)> = None;
    for t in turns {
        let overlap = (end_s.min(t.end) - start_s.max(t.start)).max(0.0);
        if overlap <= 0.0 {
            continue;
        }
        match best {
            Some((_, best_overlap)) if best_overlap >= overlap => {}
            _ => best = Some((t.speaker, overlap)),
        }
    }
    best.map(|(spk, _)| format!("Speaker {}", spk + 1))
}
