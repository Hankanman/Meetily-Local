// audio/transcription/mod.rs
//
// Transcription module: engine management and worker pool. Whisper is the
// sole local ASR engine (a prior remote-provider abstraction was removed as
// dead code — see worker.rs for TranscriptionError).

pub mod engine;
pub mod worker;

// Re-export commonly used types
pub use engine::{
    get_or_init_transcription_engine, get_or_init_whisper, validate_transcription_model_ready,
    TranscriptionEngine,
};
pub use worker::{
    reset_speech_detected_flag, start_transcription_task, TranscriptionError, TranscriptUpdate,
};
