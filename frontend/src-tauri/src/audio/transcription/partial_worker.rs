// audio/transcription/partial_worker.rs
//
// Streaming partial-transcription task. Runs ALONGSIDE the authoritative
// VAD-final transcription worker and is purely additive: it decodes
// in-progress utterance audio periodically and emits `transcript-partial`
// preview events, which the frontend renders distinctly and discards once the
// real (final) transcript for that segment arrives. Nothing here is saved, and
// the final path is entirely independent — if partial decoding fails or lags,
// the committed transcript is unaffected.

use std::collections::HashMap;

use log::{debug, info};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;

use crate::audio::recording_state::{DeviceType, PartialAudioChunk};

#[derive(Debug, Serialize, Clone)]
struct PartialUpdate {
    /// "mic" | "system"
    source: String,
    /// Stabilized preview text (may be empty to clear the current partial).
    text: String,
    utterance_id: u64,
}

/// Per-source LocalAgreement stabilization state.
#[derive(Default)]
struct SourceState {
    /// Utterance the state belongs to; a change resets stabilization.
    utterance_id: u64,
    /// Word list of the previous decode hypothesis for this utterance.
    prev_words: Vec<String>,
    /// Words committed (agreed by two consecutive hypotheses) so far. Grows
    /// monotonically within an utterance — the emitted text never shrinks.
    committed: Vec<String>,
}

/// Longest common prefix of two word slices.
fn common_prefix_len(a: &[String], b: &[String]) -> usize {
    a.iter().zip(b.iter()).take_while(|(x, y)| x == y).count()
}

fn source_str(source: DeviceType) -> &'static str {
    match source {
        DeviceType::Microphone => "mic",
        DeviceType::System => "system",
    }
}

/// Spawn the streaming partial-decode task. It owns the receiver end of the
/// pipeline's partial channel and emits `transcript-partial` events.
pub fn start_partial_decode_task<R: Runtime>(
    app: AppHandle<R>,
    mut receiver: mpsc::UnboundedReceiver<PartialAudioChunk>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        info!("🎬 Streaming partial-decode task started");
        let mut states: HashMap<DeviceType, SourceState> = HashMap::new();

        while let Some(mut chunk) = receiver.recv().await {
            // Latest-wins: if the pipeline queued several snapshots while a
            // decode was in flight, skip to the newest one PER SOURCE so we
            // never backlog stale previews. Drain everything immediately
            // available, keeping the last chunk seen for each source.
            let mut latest: HashMap<DeviceType, PartialAudioChunk> = HashMap::new();
            latest.insert(chunk.source, chunk.clone());
            while let Ok(next) = receiver.try_recv() {
                chunk = next.clone();
                latest.insert(next.source, next);
            }
            let _ = chunk; // last value already captured in `latest`

            for (source, chunk) in latest {
                if let Err(e) = decode_and_emit(&app, &mut states, source, chunk).await {
                    debug!("partial decode skipped for {:?}: {}", source, e);
                }
            }
        }
        info!("🎬 Streaming partial-decode task exiting");
    })
}

async fn decode_and_emit<R: Runtime>(
    app: &AppHandle<R>,
    states: &mut HashMap<DeviceType, SourceState>,
    source: DeviceType,
    chunk: PartialAudioChunk,
) -> Result<(), String> {
    // Grab the shared whisper engine (same instance the final worker uses).
    let engine = {
        let guard = crate::whisper_engine::commands::WHISPER_ENGINE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        guard.as_ref().cloned()
    };
    let Some(engine) = engine else {
        return Err("engine not loaded".into());
    };
    if !engine.is_model_loaded().await {
        return Err("model not loaded".into());
    }

    let language = crate::get_language_preference_internal();
    // No context prompt: a partial is a fresh best-effort decode of the
    // in-progress utterance; cross-segment context is a final-path concern.
    let (text, _conf, _partial) = engine
        .transcribe_audio_with_confidence(chunk.samples, language, None)
        .await
        .map_err(|e| e.to_string())?;

    let state = states.entry(source).or_default();
    if state.utterance_id != chunk.utterance_id {
        // New utterance — reset stabilization.
        *state = SourceState {
            utterance_id: chunk.utterance_id,
            prev_words: Vec::new(),
            committed: Vec::new(),
        };
    }

    let cur_words: Vec<String> = text.split_whitespace().map(|s| s.to_string()).collect();

    // LocalAgreement-2: commit the prefix agreed by the last two hypotheses.
    // The committed prefix only ever grows, so the preview never flickers
    // backward; the still-unstable tail is withheld until the next decode
    // confirms it (the classic stability-vs-latency tradeoff).
    let agreed = common_prefix_len(&state.prev_words, &cur_words);
    if agreed > state.committed.len() {
        state.committed = cur_words[..agreed].to_vec();
    }
    state.prev_words = cur_words;

    if state.committed.is_empty() {
        return Ok(()); // nothing stable to show yet
    }

    let update = PartialUpdate {
        source: source_str(source).to_string(),
        text: state.committed.join(" "),
        utterance_id: chunk.utterance_id,
    };
    let _ = app.emit("transcript-partial", &update);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::common_prefix_len;

    fn words(s: &str) -> Vec<String> {
        s.split_whitespace().map(|w| w.to_string()).collect()
    }

    #[test]
    fn prefix_of_growing_hypotheses() {
        // Second decode extends the first: agreed prefix is the whole first.
        assert_eq!(
            common_prefix_len(&words("let us start the"), &words("let us start the meeting")),
            4
        );
    }

    #[test]
    fn prefix_stops_at_first_divergence() {
        // whisper revised "there" → "their"; only "we think" is agreed.
        assert_eq!(
            common_prefix_len(&words("we think there is"), &words("we think their is time")),
            2
        );
    }

    #[test]
    fn no_agreement_and_empty() {
        assert_eq!(common_prefix_len(&words("hello world"), &words("goodbye now")), 0);
        assert_eq!(common_prefix_len(&[], &words("anything")), 0);
        assert_eq!(common_prefix_len(&words("anything"), &[]), 0);
    }
}
