// Shell-side Tauri command modules. Core logic lives in the `meetily-core`
// crate (re-exported at crate root); these thin wrappers adapt it to
// `#[tauri::command]` signatures (`AppHandle`, `State`, event emission).
pub mod anthropic;
pub mod audio;
pub mod calendar;
pub mod database;
pub mod groq;
pub mod ollama;
pub mod openai;
pub mod openrouter;
pub mod speaker_diarization;
pub mod summary;
pub mod whisper_engine;
