// Commit name to recover the serial whisper engine processing for smaller meetings [Slower processing but dooes not fail] - "before parallel processing implementation"

use crate::config::WHISPER_MODEL_CATALOG;
use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelStatus {
    Available,
    Missing,
    Downloading {
        progress: u8,
    },
    Error(String),
    Corrupted {
        file_size: u64,
        expected_min_size: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub path: PathBuf,
    pub size_mb: u32,
    pub accuracy: String,
    pub speed: String,
    pub status: ModelStatus,
    pub description: String,
}

pub struct WhisperEngine {
    models_dir: PathBuf,
    // Wrapped in an Arc so a cheap clone can be handed to spawn_blocking for
    // inference/model-loading without holding the RwLock guard (or the
    // WhisperContext itself) across the blocking call.
    current_context: Arc<RwLock<Option<Arc<WhisperContext>>>>,
    current_model: Arc<RwLock<Option<String>>>,
    available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,
    // State tracking for smart logging
    last_transcription_was_short: Arc<RwLock<bool>>,
    short_audio_warning_logged: Arc<RwLock<bool>>,
    // Performance optimization: reduce logging frequency
    transcription_count: Arc<RwLock<u64>>,
    // Tracks in-flight downloads and cooperative cancellation requests
    // (shared with summary_engine::model_manager's downloader).
    download_guard: Arc<crate::utils::download::DownloadGuard>,
}

/// Check a file's header for a GGML/GGUF magic number. Plain `std::fs`
/// (blocking) rather than `tokio::fs` — it's an 8-byte read, and this needs
/// to be callable from both async (`WhisperEngine::discover_models`) and
/// sync (`whisper_engine::commands::discover_models_standalone`, used
/// before the engine - and its async runtime access - is initialized)
/// contexts without extra ceremony.
fn validate_model_file_magic(model_path: &std::path::Path) -> Result<()> {
    use std::io::Read;

    let mut file =
        std::fs::File::open(model_path).map_err(|e| anyhow!("Failed to open model file: {}", e))?;

    // Read the first 8 bytes to check for GGML magic number
    let mut buffer = [0u8; 8];
    file.read_exact(&mut buffer)
        .map_err(|e| anyhow!("Failed to read model file header: {}", e))?;

    // Check for GGML magic number (various versions and endianness)
    if buffer.starts_with(b"ggml")
        || buffer.starts_with(b"GGUF")
        || buffer.starts_with(b"ggmf")
        || buffer.starts_with(b"lmgg")
        || buffer.starts_with(b"FUGU")
        || buffer.starts_with(b"fmgg")
    {
        Ok(())
    } else {
        Err(anyhow!(
            "Invalid model file: missing GGML/GGUF magic number. Found: {:?}",
            String::from_utf8_lossy(&buffer[..4])
        ))
    }
}

/// Scan one [`WHISPER_MODEL_CATALOG`] entry against `models_dir`, applying
/// the standard size + magic-number corruption checks. Shared by
/// `WhisperEngine::discover_models` and the standalone fallback
/// (`whisper_engine::commands::discover_models_standalone`) used when the
/// engine hasn't been initialized yet, so both agree on what counts as
/// `Available` / `Corrupted` / `Missing`.
///
/// `downloading_progress` is the in-memory `Downloading { progress }` value
/// for this model, if the caller has one (only `WhisperEngine` does, via
/// its `available_models` cache) - it's what keeps an in-progress download
/// from being misreported as a corrupted file. Pass `None` when no such
/// state is available.
pub fn scan_catalog_entry(
    models_dir: &std::path::Path,
    filename: &str,
    size_mb: u32,
    downloading_progress: Option<u8>,
) -> ModelStatus {
    let model_path = models_dir.join(filename);

    let Ok(metadata) = std::fs::metadata(&model_path) else {
        return ModelStatus::Missing;
    };

    let file_size_bytes = metadata.len();
    let file_size_mb = file_size_bytes / (1024 * 1024);
    // Allow 90% of expected size as minimum for more accurate corruption detection
    let expected_min_size_mb = (size_mb as f64 * 0.9) as u64;

    if file_size_mb >= expected_min_size_mb && file_size_mb > 1 {
        // File size looks good, but let's also check if it's a valid GGML file
        match validate_model_file_magic(&model_path) {
            Ok(_) => ModelStatus::Available,
            Err(_) => {
                log::warn!(
                    "Model file {} has correct size but appears corrupted (failed validation)",
                    filename
                );
                ModelStatus::Corrupted {
                    file_size: file_size_bytes,
                    expected_min_size: expected_min_size_mb * 1024 * 1024,
                }
            }
        }
    } else if file_size_mb > 0 {
        // File exists but is smaller than expected
        if let Some(progress) = downloading_progress {
            log::debug!(
                "Model {} appears to be downloading ({} MB so far, {}% complete)",
                filename,
                file_size_mb,
                progress
            );
            ModelStatus::Downloading { progress }
        } else {
            log::warn!(
                "Model file {} exists but is corrupted ({} MB, expected ~{} MB)",
                filename,
                file_size_mb,
                size_mb
            );
            ModelStatus::Corrupted {
                file_size: file_size_bytes,
                expected_min_size: expected_min_size_mb * 1024 * 1024,
            }
        }
    } else {
        ModelStatus::Missing
    }
}

impl WhisperEngine {
    /// Detect available GPU acceleration capabilities
    fn detect_gpu_acceleration() -> bool {
        // On macOS, prefer Metal GPU acceleration
        if cfg!(target_os = "macos") {
            log::info!("macOS detected - attempting to enable Metal GPU acceleration");
            return true; // Enable GPU by default on macOS, whisper-rs will fallback if needed
        }

        // Check for CUDA support on other platforms
        if cfg!(feature = "cuda") {
            log::info!("CUDA feature enabled - attempting GPU acceleration");
            return true;
        }

        // Check for Vulkan support on other platforms
        if cfg!(feature = "vulkan") {
            log::info!("Vulkan feature enabled - attempting GPU acceleration");
            return true;
        }

        // Fall back to CPU
        log::info!("No GPU acceleration features detected - using CPU processing");
        false
    }

    pub fn new() -> Result<Self> {
        Self::new_with_models_dir(None)
    }

    /// Create a new WhisperEngine with optional custom models directory
    /// If models_dir is None, uses default location (app data dir for production, local for dev)
    pub fn new_with_models_dir(models_dir: Option<PathBuf>) -> Result<Self> {
        // PERFORMANCE: Suppress verbose whisper.cpp and Metal logs
        // These C library logs bypass Rust logging and clutter output
        // Set environment variables to reduce C library verbosity
        std::env::set_var("GGML_METAL_LOG_LEVEL", "1"); // 0=off, 1=error, 2=warn, 3=info
        std::env::set_var("WHISPER_LOG_LEVEL", "1"); // Reduce whisper.cpp verbosity

        let models_dir = if let Some(dir) = models_dir {
            // Use provided directory (for production with app_data_dir)
            dir
        } else {
            // Fallback: determine based on debug/release mode
            let current_dir = std::env::current_dir()
                .map_err(|e| anyhow!("Failed to get current directory: {}", e))?;

            // Development: Use frontend/models or backend directories
            // Production: Use system directories (should be overridden by caller)
            if cfg!(debug_assertions) {
                // Development mode - try frontend and backend directories
                if current_dir.join("models").exists() {
                    current_dir.join("models")
                } else if current_dir.join("../models").exists() {
                    current_dir.join("../models")
                } else if current_dir
                    .join("backend/whisper-server-package/models")
                    .exists()
                {
                    current_dir.join("backend/whisper-server-package/models")
                } else if current_dir
                    .join("../backend/whisper-server-package/models")
                    .exists()
                {
                    current_dir.join("../backend/whisper-server-package/models")
                } else {
                    // Create models directory in current directory for development
                    current_dir.join("models")
                }
            } else {
                // Production mode fallback (shouldn't reach here, caller should provide path)
                log::warn!("WhisperEngine: No models directory provided, using fallback path");
                dirs::data_dir()
                    .or_else(|| dirs::home_dir())
                    .ok_or_else(|| anyhow!("Could not find system data directory"))?
                    .join("Meetily")
                    .join("models")
            }
        };

        log::info!(
            "WhisperEngine using models directory: {}",
            models_dir.display()
        );
        log::info!("Debug mode: {}", cfg!(debug_assertions));

        // Log acceleration capabilities
        let gpu_support = Self::detect_gpu_acceleration();
        log::info!(
            "Hardware acceleration support: {}",
            if gpu_support { "enabled" } else { "disabled" }
        );

        #[cfg(feature = "openblas")]
        log::info!("OpenBLAS CPU optimization: enabled");

        #[cfg(feature = "cuda")]
        log::info!("NVIDIA CUDA support: enabled");

        #[cfg(feature = "vulkan")]
        log::info!("Vulkan GPU support: enabled");

        #[cfg(feature = "openmp")]
        log::info!("OpenMP parallel processing: enabled");

        let engine = Self {
            models_dir,
            current_context: Arc::new(RwLock::new(None)),
            current_model: Arc::new(RwLock::new(None)),
            available_models: Arc::new(RwLock::new(HashMap::new())),
            // Initialize state tracking
            last_transcription_was_short: Arc::new(RwLock::new(false)),
            short_audio_warning_logged: Arc::new(RwLock::new(false)),
            // Performance optimization: reduce logging frequency
            transcription_count: Arc::new(RwLock::new(0)),
            // Initialize download tracking
            download_guard: Arc::new(crate::utils::download::DownloadGuard::new()),
        };

        Ok(engine)
    }

    pub async fn discover_models(&self) -> Result<Vec<ModelInfo>> {
        let models_dir = &self.models_dir;
        let mut models = Vec::new();
        // Use centralized model catalog from config.rs
        let model_configs = WHISPER_MODEL_CATALOG;

        // Snapshot current statuses once up front rather than re-locking per
        // catalog entry - only used to tell "still downloading" apart from
        // "corrupted" for an undersized file below.
        let current_statuses = self.available_models.read().await.clone();

        for &(name, filename, size_mb, accuracy, speed, description) in model_configs {
            let downloading_progress = match current_statuses.get(name).map(|m| &m.status) {
                Some(ModelStatus::Downloading { progress }) => Some(*progress),
                _ => None,
            };

            let status = scan_catalog_entry(models_dir, filename, size_mb, downloading_progress);

            let model_info = ModelInfo {
                name: name.to_string(),
                path: models_dir.join(filename),
                size_mb,
                accuracy: accuracy.to_string(),
                speed: speed.to_string(),
                status,
                description: description.to_string(),
            };

            models.push(model_info);
        }

        // Update internal cache
        let mut available_models = self.available_models.write().await;
        available_models.clear();
        for model in &models {
            available_models.insert(model.name.clone(), model.clone());
        }

        Ok(models)
    }

    pub async fn load_model(&self, model_name: &str) -> Result<()> {
        let models = self.available_models.read().await;
        let model_info = models
            .get(model_name)
            .ok_or_else(|| anyhow!("Model {} not found", model_name))?;

        match model_info.status {
            ModelStatus::Available => {
                // FIX 5: Check if this model is already loaded
                // Clone into an owned value so the read guard is dropped
                // before we potentially call unload_model() below — holding
                // it across that call deadlocks, since unload_model() needs
                // a write lock on this same field.
                let currently_loaded = self.current_model.read().await.clone();
                if let Some(current_model) = currently_loaded {
                    if current_model == model_name {
                        log::info!("Model {} is already loaded, skipping reload", model_name);
                        return Ok(());
                    }

                    // FIX 5: Unload current model before loading new one
                    log::info!(
                        "Unloading current model '{}' before loading '{}'",
                        current_model,
                        model_name
                    );
                    self.unload_model().await;
                }

                log::info!("Loading model: {}", model_name);

                // PERFORMANCE OPTIMIZATION: Use comprehensive hardware profile for optimal GPU configuration
                let hardware_profile = crate::audio::HardwareProfile::detect();
                let adaptive_config = hardware_profile.get_whisper_config();

                // Enable flash attention for high-end GPUs (Metal on Apple Silicon, CUDA on NVIDIA)
                // Flash attention provides 20-40% speedup but requires stable GPU drivers
                let flash_attn_enabled = match (
                    &hardware_profile.gpu_type,
                    &hardware_profile.performance_tier,
                ) {
                    (
                        crate::audio::GpuType::Metal,
                        crate::audio::PerformanceTier::Ultra | crate::audio::PerformanceTier::High,
                    ) => true,
                    (
                        crate::audio::GpuType::Cuda,
                        crate::audio::PerformanceTier::Ultra | crate::audio::PerformanceTier::High,
                    ) => true,
                    _ => false, // Conservative: disable for other GPU types and lower tiers
                };

                let context_param = WhisperContextParameters {
                    use_gpu: adaptive_config.use_gpu,
                    gpu_device: 0,
                    flash_attn: flash_attn_enabled,
                    ..Default::default()
                };

                // PERFORMANCE: Suppress verbose C library logs during model loading
                // This hides the excessive Metal/GGML initialization logs in release builds
                //
                // Parsing model weights and allocating GPU buffers is a slow,
                // synchronous operation (can take seconds for large models) —
                // run it on a blocking-pool thread so it doesn't stall the
                // async runtime.
                let model_path = model_info.path.clone();
                let model_name_owned = model_name.to_string();
                let ctx = tokio::task::spawn_blocking(move || {
                    // let _suppressor = crate::whisper_engine::StderrSuppressor::new();

                    // Load whisper context with hardware-optimized parameters
                    WhisperContext::new_with_params(&model_path, context_param)
                        .map_err(|e| anyhow!("Failed to load model {}: {}", model_name_owned, e))
                    // Suppressor dropped here, stderr restored
                })
                .await
                .map_err(|e| anyhow!("Model loading task panicked: {}", e))??;

                // Update current context and model
                *self.current_context.write().await = Some(Arc::new(ctx));
                *self.current_model.write().await = Some(model_name.to_string());

                // Enhanced acceleration status reporting
                let acceleration_status = match (&hardware_profile.gpu_type, flash_attn_enabled) {
                    (crate::audio::GpuType::Metal, true) => {
                        "Metal GPU with Flash Attention (Ultra-Fast)"
                    }
                    (crate::audio::GpuType::Metal, false) => "Metal GPU acceleration",
                    (crate::audio::GpuType::Cuda, true) => {
                        "CUDA GPU with Flash Attention (Ultra-Fast)"
                    }
                    (crate::audio::GpuType::Cuda, false) => "CUDA GPU acceleration",
                    (crate::audio::GpuType::Vulkan, _) => "Vulkan GPU acceleration",
                    (crate::audio::GpuType::OpenCL, _) => "OpenCL GPU acceleration",
                    (crate::audio::GpuType::None, _) => "CPU processing only",
                };

                log::info!("Successfully loaded model: {} with {} (Performance Tier: {:?}, Beam Size: {}, Threads: {:?})",
                          model_name, acceleration_status, hardware_profile.performance_tier,
                          adaptive_config.beam_size, adaptive_config.max_threads);
                Ok(())
            }
            ModelStatus::Missing => Err(anyhow!("Model {} is not downloaded", model_name)),
            ModelStatus::Downloading { .. } => {
                Err(anyhow!("Model {} is currently downloading", model_name))
            }
            ModelStatus::Error(ref err) => Err(anyhow!("Model {} has error: {}", model_name, err)),
            ModelStatus::Corrupted { .. } => Err(anyhow!(
                "Model {} is corrupted and cannot be loaded",
                model_name
            )),
        }
    }

    pub async fn unload_model(&self) -> bool {
        let mut ctx_guard = self.current_context.write().await;
        let unloaded = ctx_guard.take().is_some();
        if unloaded {
            log::info!("📉Whisper model unloaded");
        }

        let mut model_name_guard = self.current_model.write().await;
        model_name_guard.take();

        unloaded
    }

    pub async fn get_current_model(&self) -> Option<String> {
        self.current_model.read().await.clone()
    }

    pub async fn is_model_loaded(&self) -> bool {
        self.current_context.read().await.is_some()
    }

    // Enhanced function to clean repetitive text patterns and meaningless outputs
    fn clean_repetitive_text(text: &str) -> String {
        if text.is_empty() {
            return String::new();
        }

        // Check for obviously meaningless patterns first
        if Self::is_meaningless_output(text) {
            // Performance optimization: reduce meaningless output logging to debug level
            perf_debug!("Detected meaningless output, returning empty: '{}'", text);
            return String::new();
        }

        let words: Vec<&str> = text.split_whitespace().collect();
        if words.len() < 3 {
            return text.to_string();
        }

        // Enhanced repetition detection with sliding window
        let cleaned_words = Self::remove_word_repetitions(&words);

        // Remove phrase repetitions with more sophisticated detection
        let cleaned_words = Self::remove_phrase_repetitions(&cleaned_words);

        // Check for overall repetition ratio
        let final_text = cleaned_words.join(" ");
        if Self::calculate_repetition_ratio(&final_text) > 0.7 {
            // Performance optimization: reduce repetition ratio logging to debug level
            perf_debug!(
                "High repetition ratio detected, filtering out: '{}'",
                final_text
            );
            return String::new();
        }

        final_text
    }

    // Check for obviously meaningless patterns
    fn is_meaningless_output(text: &str) -> bool {
        let text_lower = text.to_lowercase();

        // Check for common meaningless patterns
        let meaningless_patterns = [
            "thank you for watching",
            "thanks for watching",
            "like and subscribe",
            "music playing",
            "applause",
            "laughter",
            "um um um",
            "uh uh uh",
            "ah ah ah",
        ];

        for pattern in &meaningless_patterns {
            if text_lower.contains(pattern) {
                return true;
            }
        }

        // Check if text is mostly the same character or very short repetitive patterns
        let unique_chars: HashSet<char> = text.chars().collect();
        if unique_chars.len() <= 3 && text.len() > 10 {
            return true;
        }

        false
    }

    // Enhanced word repetition removal
    fn remove_word_repetitions<'a>(words: &'a [&'a str]) -> Vec<&'a str> {
        let mut cleaned_words = Vec::new();
        let mut i = 0;

        while i < words.len() {
            let current_word = words[i];
            let mut repeat_count = 1;

            // Count consecutive repetitions of the same word
            while i + repeat_count < words.len() && words[i + repeat_count] == current_word {
                repeat_count += 1;
            }

            // Be more aggressive: if word is repeated 2+ times, only keep one instance
            if repeat_count >= 2 {
                cleaned_words.push(current_word);
                i += repeat_count;
            } else {
                cleaned_words.push(current_word);
                i += 1;
            }
        }

        cleaned_words
    }

    // Enhanced phrase repetition removal with variable length detection
    fn remove_phrase_repetitions<'a>(words: &'a [&'a str]) -> Vec<&'a str> {
        if words.len() < 4 {
            return words.to_vec();
        }

        let mut final_words = Vec::new();
        let mut i = 0;

        while i < words.len() {
            let mut phrase_found = false;

            // Check for 2-word to 5-word phrase repetitions
            for phrase_len in 2..=std::cmp::min(5, (words.len() - i) / 2) {
                if i + phrase_len * 2 <= words.len() {
                    let phrase1 = &words[i..i + phrase_len];
                    let phrase2 = &words[i + phrase_len..i + phrase_len * 2];

                    if phrase1 == phrase2 {
                        // Add the phrase once and skip the repetition
                        final_words.extend_from_slice(phrase1);
                        i += phrase_len * 2;
                        phrase_found = true;
                        break;
                    }
                }
            }

            if !phrase_found {
                final_words.push(words[i]);
                i += 1;
            }
        }

        final_words
    }

    // Calculate repetition ratio in text
    fn calculate_repetition_ratio(text: &str) -> f32 {
        let words: Vec<&str> = text.split_whitespace().collect();
        if words.len() < 4 {
            return 0.0;
        }

        let mut word_counts = HashMap::new();
        for word in &words {
            *word_counts.entry(word.to_lowercase()).or_insert(0) += 1;
        }

        let total_words = words.len() as f32;
        let repeated_words: usize = word_counts
            .values()
            .map(|&count| if count > 1 { count - 1 } else { 0 })
            .sum();

        repeated_words as f32 / total_words
    }

    /// Transcribe audio with streaming support for partial results and adaptive quality
    pub async fn transcribe_audio_with_confidence(
        &self,
        audio_data: Vec<f32>,
        language: Option<String>,
    ) -> Result<(String, f32, bool)> {
        let ctx = {
            let ctx_lock = self.current_context.read().await;
            ctx_lock
                .as_ref()
                .cloned()
                .ok_or_else(|| anyhow!("No model loaded. Please load a model first."))?
        };

        let duration_seconds = audio_data.len() as f64 / 16000.0;
        let is_partial = duration_seconds < 15.0; // Consider chunks under 15s as partial

        // PERFORMANCE: Suppress verbose C library logs during transcription
        // This hides whisper_full_with_state debug logs and beam search details
        //
        // Whisper inference — including building `FullParams`, which is CPU-
        // bound and can take seconds — runs on a blocking-pool thread so it
        // doesn't stall the async runtime. `FullParams::set_language` borrows
        // from `language`, so building it here (rather than outside and
        // moving it in) keeps that borrow entirely local to this closure;
        // `language` is captured by value, so nothing non-'static crosses
        // the spawn_blocking boundary.
        let (result, total_confidence, segment_count) =
            tokio::task::spawn_blocking(move || -> Result<(String, f32, i32)> {
                // let _suppressor = crate::whisper_engine::StderrSuppressor::new();

                // Get adaptive configuration based on hardware
                let hardware_profile = crate::audio::HardwareProfile::detect();
                let adaptive_config = hardware_profile.get_whisper_config();

                // ADAPTIVE parameters - optimized for current hardware
                let mut params = FullParams::new(SamplingStrategy::BeamSearch {
                    beam_size: adaptive_config.beam_size as i32,
                    patience: 1.0,
                });

                // Configure with adaptive settings
                // If language is "auto" or None, use automatic language detection (pass None)
                // If language is "auto-translate", enable translation to English
                // Otherwise, use the specified language code
                let (language_code, should_translate) = match language.as_deref() {
                    Some("auto") | None => (None, false),
                    Some("auto-translate") => (None, true),
                    Some(lang) => (Some(lang), false),
                };
                params.set_language(language_code);
                params.set_translate(should_translate);

                // CRITICAL: Disable timestamp tokens to prevent whisper.cpp chunking heuristics
                // The "single timestamp ending - skip entire chunk" optimization incorrectly discards
                // complete, valid transcriptions. Disabling timestamps forces whisper to return ALL text.
                params.set_no_timestamps(true); // Prevent timestamp-based segment skipping
                params.set_token_timestamps(true); // Keep for any timestamp-aware features

                // PERFORMANCE: Disable ALL whisper.cpp internal printing
                // This reduces C library log spam significantly
                params.set_print_special(false); // Don't print special tokens
                params.set_print_progress(false); // Don't print progress
                params.set_print_realtime(false); // Don't print realtime info
                params.set_print_timestamps(false); // Don't print timestamps

                // Additional suppression to reduce C library verbosity
                params.set_suppress_blank(true);
                params.set_suppress_nst(true);
                params.set_temperature(adaptive_config.temperature);
                params.set_max_initial_ts(1.0);
                params.set_entropy_thold(2.4);
                params.set_logprob_thold(-1.0);
                // BALANCED FIX: Lowered from 0.75 to 0.55 to allow quiet speech detection
                // Previous value was too aggressive and rejected valid quiet speech
                // 0.55 is balanced - prevents hallucinations while preserving quiet speech
                params.set_no_speech_thold(0.55);
                params.set_max_len(200);
                params.set_single_segment(false);

                // Set thread count based on hardware (if supported by whisper.cpp)
                if let Some(_max_threads) = adaptive_config.max_threads {
                    // Note: whisper.cpp may or may not expose thread control through params
                    // Removed debug log to reduce I/O overhead in transcription hot path
                }

                let mut state = ctx.create_state()?;
                state.full(params, &audio_data)?;
                let num_segments = state.full_n_segments();
                // Suppressor dropped here, stderr restored

                let mut result = String::new();
                let mut total_confidence = 0.0f32;
                let mut segment_count = 0;

                for i in 0..num_segments {
                    let Some(segment) = state.get_segment(i) else {
                        continue;
                    };
                    let segment_text = match segment.to_str_lossy() {
                        Ok(text) => text.into_owned(),
                        Err(_) => continue,
                    };

                    // Calculate confidence based on segment length and duration (simplified approach)
                    let segment_length = segment_text.len() as f32;
                    let segment_confidence = if segment_length > 0.0 {
                        (segment_length / 100.0).min(0.9) + 0.1 // 0.1 to 1.0 confidence based on text length
                    } else {
                        0.1
                    };
                    total_confidence += segment_confidence;
                    segment_count += 1;

                    let cleaned_text = segment_text.trim();
                    if !cleaned_text.is_empty() {
                        if !result.is_empty() {
                            result.push(' ');
                        }
                        result.push_str(cleaned_text);
                    }
                }

                Ok((result, total_confidence, segment_count))
            })
            .await
            .map_err(|e| anyhow!("Transcription task panicked: {}", e))??;

        let final_result = result.trim().to_string();
        let cleaned_result = Self::clean_repetitive_text(&final_result);

        let avg_confidence = if segment_count > 0 {
            total_confidence / segment_count as f32
        } else {
            0.0
        };

        Ok((cleaned_result, avg_confidence, is_partial))
    }

    pub async fn transcribe_audio(
        &self,
        audio_data: Vec<f32>,
        language: Option<String>,
    ) -> Result<String> {
        let ctx = {
            let ctx_lock = self.current_context.read().await;
            ctx_lock
                .as_ref()
                .cloned()
                .ok_or_else(|| anyhow!("No model loaded. Please load a model first."))?
        };

        // Duration-based optimization is handled by beam search parameters
        let duration_seconds = audio_data.len() as f64 / 16000.0; // Assuming 16kHz
        let is_short_audio = duration_seconds < 1.0;

        // Smart logging based on audio duration and previous states
        let mut should_log_transcription = true;
        let mut should_log_short_warning = false;

        if is_short_audio {
            let last_was_short = *self.last_transcription_was_short.read().await;
            let warning_logged = *self.short_audio_warning_logged.read().await;

            if !warning_logged {
                should_log_short_warning = true;
                *self.short_audio_warning_logged.write().await = true;
            }

            // Only log transcription start if it's the first short audio or previous wasn't short
            should_log_transcription = !last_was_short;

            *self.last_transcription_was_short.write().await = true;
        } else {
            let last_was_short = *self.last_transcription_was_short.read().await;

            // Always log when transitioning from short to normal audio
            if last_was_short {
                log::info!("Audio duration normalized, resuming transcription");
                *self.short_audio_warning_logged.write().await = false;
            }

            *self.last_transcription_was_short.write().await = false;
        }

        if should_log_short_warning {
            log::warn!("Audio duration is short ({:.1}s < 1.0s). Consider padding the input audio with silence. Further short audio warnings will be suppressed.", duration_seconds);
        }

        // Performance optimization: reduce transcription start logging frequency
        let transcription_count = {
            let mut count = self.transcription_count.write().await;
            *count += 1;
            *count
        };

        // Only log every 10th transcription or significant audio (>10s) to reduce I/O overhead
        if should_log_transcription && (transcription_count % 10 == 0 || duration_seconds > 10.0) {
            log::info!(
                "Starting transcription #{} of {} samples ({:.1}s duration)",
                transcription_count,
                audio_data.len(),
                duration_seconds
            );
        }
        // Whisper inference — including building `FullParams`, which is CPU-
        // bound and can take seconds — runs on a blocking-pool thread so it
        // doesn't stall the async runtime. `FullParams::set_language` borrows
        // from `language`, so building it here (rather than outside and
        // moving it in) keeps that borrow entirely local to this closure;
        // `language` is captured by value, so nothing non-'static crosses
        // the spawn_blocking boundary.
        let result = tokio::task::spawn_blocking(move || -> Result<String> {
            // Get adaptive configuration based on hardware
            let hardware_profile = crate::audio::HardwareProfile::detect();
            let adaptive_config = hardware_profile.get_whisper_config();

            // ADAPTIVE parameters - optimized for current hardware
            let mut params = FullParams::new(SamplingStrategy::BeamSearch {
                beam_size: adaptive_config.beam_size as i32,
                patience: 1.0,
            });

            // Configure for good quality
            // If language is "auto" or None, use automatic language detection (pass None)
            // If language is "auto-translate", enable translation to English
            // Otherwise, use the specified language code
            let (language_code, should_translate) = match language.as_deref() {
                Some("auto") | None => (None, false),
                Some("auto-translate") => (None, true),
                Some(lang) => (Some(lang), false),
            };
            params.set_language(language_code);
            params.set_translate(should_translate);

            // CRITICAL: Disable timestamp tokens to prevent whisper.cpp chunking heuristics
            // The "single timestamp ending - skip entire chunk" optimization incorrectly discards
            // complete, valid transcriptions. Disabling timestamps forces whisper to return ALL text.
            params.set_no_timestamps(true); // Prevent timestamp-based segment skipping
            params.set_token_timestamps(true); // Keep for any timestamp-aware features

            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);

            // BALANCED settings - good quality with reasonable speed
            params.set_suppress_blank(true);
            params.set_suppress_nst(true);
            params.set_temperature(0.3); // Lower than 0.4 for consistency, higher than 0.0 for quality
            params.set_max_initial_ts(1.0);
            params.set_entropy_thold(2.4);
            params.set_logprob_thold(-1.0);
            // BALANCED FIX: Lowered from 0.75 to 0.55 to allow quiet speech detection
            // Previous value was too aggressive and rejected valid quiet speech
            // 0.55 is balanced - prevents hallucinations while preserving quiet speech
            params.set_no_speech_thold(0.55);

            // Reasonable length limits
            params.set_max_len(200); // Reasonable length
            params.set_single_segment(false); // Allow multiple segments for better accuracy

            // Note: compression_ratio_threshold would be ideal but not available in current whisper-rs
            // This would help detect repetitive outputs: params.set_compression_ratio_threshold(2.4);

            let mut state = ctx.create_state()?;
            state.full(params, &audio_data)?;

            // Extract text with improved segment handling
            let num_segments = state.full_n_segments();

            // Performance optimization: reduce segment completion logging
            // Only log for significant transcriptions to avoid I/O overhead
            if (should_log_transcription || num_segments > 0)
                && (num_segments > 3 || duration_seconds > 5.0)
            {
                perf_debug!(
                    "Transcription #{} completed with {} segments ({:.1}s)",
                    transcription_count,
                    num_segments,
                    duration_seconds
                );
            }
            let mut result = String::new();

            for i in 0..num_segments {
                let Some(segment) = state.get_segment(i) else {
                    continue;
                };
                let segment_text = match segment.to_str_lossy() {
                    Ok(text) => text.into_owned(),
                    Err(_) => continue,
                };

                let _start_time = segment.start_timestamp();
                let _end_time = segment.end_timestamp();

                // Performance optimization: remove per-segment debug logging
                // This was causing significant I/O overhead during transcription
                // Only log segments for very long audio (>30s) or when explicitly debugging
                if duration_seconds > 30.0 {
                    perf_trace!(
                        "Segment {} ({:.2}s-{:.2}s): '{}'",
                        i,
                        _start_time as f64 / 100.0,
                        _end_time as f64 / 100.0,
                        segment_text
                    );
                }

                // Clean and append segment text
                let cleaned_text = segment_text.trim();
                if !cleaned_text.is_empty() {
                    if !result.is_empty() {
                        result.push(' ');
                    }
                    result.push_str(cleaned_text);
                }
            }

            Ok(result)
        })
        .await
        .map_err(|e| anyhow!("Transcription task panicked: {}", e))??;

        let final_result = result.trim().to_string();

        // Check for repetition loops and clean them up
        let cleaned_result = Self::clean_repetitive_text(&final_result);

        // Performance optimization: smart logging for transcription results
        if cleaned_result.is_empty() {
            // Only log empty results occasionally to reduce spam
            if should_log_transcription && transcription_count % 20 == 0 {
                perf_debug!(
                    "Transcription #{} result is empty - no speech detected",
                    transcription_count
                );
            }
        } else {
            if cleaned_result != final_result {
                log::info!(
                    "Cleaned repetitive transcription #{}: '{}' -> '{}'",
                    transcription_count,
                    final_result,
                    cleaned_result
                );
            }
            // Reduce successful transcription logging frequency
            // Only log every 5th result or significant results (>50 chars) to reduce I/O overhead
            if transcription_count % 5 == 0 || cleaned_result.len() > 50 || duration_seconds > 10.0
            {
                log::info!(
                    "Transcription #{} result: '{}'",
                    transcription_count,
                    cleaned_result
                );
            } else {
                perf_debug!(
                    "Transcription #{} result: '{}'",
                    transcription_count,
                    cleaned_result
                );
            }
        }

        Ok(cleaned_result)
    }

    pub async fn get_models_directory(&self) -> PathBuf {
        self.models_dir.clone()
    }

    pub async fn delete_model(&self, model_name: &str) -> Result<String> {
        log::info!("Attempting to delete model: {}", model_name);

        // Get model info to find the file path
        let model_info = {
            let models = self.available_models.read().await;
            models.get(model_name).cloned()
        };

        let model_info = model_info.ok_or_else(|| anyhow!("Model '{}' not found", model_name))?;

        // Check if model is corrupted before allowing deletion
        log::info!("Model '{}' has status: {:?}", model_name, model_info.status);
        match &model_info.status {
            ModelStatus::Corrupted {
                file_size,
                expected_min_size,
            } => {
                log::info!(
                    "Deleting corrupted model '{}' (file size: {} bytes, expected min: {} bytes)",
                    model_name,
                    file_size,
                    expected_min_size
                );

                // Delete the file
                if model_info.path.exists() {
                    fs::remove_file(&model_info.path).await.map_err(|e| {
                        anyhow!(
                            "Failed to delete file '{}': {}",
                            model_info.path.display(),
                            e
                        )
                    })?;
                    log::info!(
                        "Successfully deleted corrupted file: {}",
                        model_info.path.display()
                    );
                } else {
                    log::warn!(
                        "File '{}' does not exist, nothing to delete",
                        model_info.path.display()
                    );
                }

                // Update model status to Missing
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Missing;
                    }
                }

                Ok(format!(
                    "Successfully deleted corrupted model '{}'",
                    model_name
                ))
            }
            ModelStatus::Available => {
                // Allow deletion of available models for testing/cleanup
                log::info!("Deleting available model '{}' (for cleanup)", model_name);

                if model_info.path.exists() {
                    fs::remove_file(&model_info.path).await.map_err(|e| {
                        anyhow!(
                            "Failed to delete file '{}': {}",
                            model_info.path.display(),
                            e
                        )
                    })?;
                    log::info!(
                        "Successfully deleted available model file: {}",
                        model_info.path.display()
                    );
                } else {
                    log::warn!(
                        "File '{}' does not exist, nothing to delete",
                        model_info.path.display()
                    );
                }

                // Update model status to Missing
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Missing;
                    }
                }

                Ok(format!("Successfully deleted model '{}'", model_name))
            }
            _ => Err(anyhow!(
                "Can only delete corrupted or available models. Model '{}' has status: {:?}",
                model_name,
                model_info.status
            )),
        }
    }

    pub async fn download_model(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(u8) + Send>>,
    ) -> Result<()> {
        log::info!("Starting download for model: {}", model_name);

        // Atomically check-and-insert so two concurrent calls for the same
        // model can't both pass the check and race to write the same file.
        if self.download_guard.begin(model_name).await.is_err() {
            log::warn!("Download already in progress for model: {}", model_name);
            return Err(anyhow!(
                "Download already in progress for model: {}",
                model_name
            ));
        }

        // Official ggerganov/whisper.cpp model URLs from Hugging Face
        let model_url = match model_name {
            // Standard f16 models
            "tiny" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
            "base" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
            "small" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
            "medium" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
            "large-v3-turbo" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
            "large-v3" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",

            // Q5_1 quantized models
            "tiny-q5_1" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin",
            "base-q5_1" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin",
            "small-q5_1" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",

            // Q5_0 quantized models
            "medium-q5_0" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin",
            "large-v3-turbo-q5_0" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
            "large-v3-q5_0" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin",

            _ => {
                self.download_guard.finish(model_name).await;
                return Err(anyhow!("Unsupported model: {}", model_name));
            }
        };

        log::info!("Model URL for {}: {}", model_name, model_url);

        // Generate correct filename - all models follow ggml-{model_name}.bin pattern
        let filename = format!("ggml-{}.bin", model_name);
        let file_path = self.models_dir.join(&filename);

        log::info!("Downloading to file path: {}", file_path.display());

        // Create models directory if it doesn't exist
        if !self.models_dir.exists() {
            fs::create_dir_all(&self.models_dir)
                .await
                .map_err(|e| anyhow!("Failed to create models directory: {}", e))?;
        }

        // Update model status to downloading
        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::Downloading { progress: 0 };
            }
        }

        let client = Client::new();

        // The shared downloader's progress callback is sync (it can't
        // `.await`), so the in-memory status mirror is updated via
        // `try_write` here — best-effort, since the callback also fires the
        // caller-supplied `progress_callback` (which drives the Tauri event
        // the frontend actually renders) on every tick regardless.
        let models_for_progress = self.available_models.clone();
        let model_name_for_progress = model_name.to_string();

        let result = crate::utils::download::download_file(
            crate::utils::download::DownloadRequest {
                client: &client,
                url: model_url,
                dest_path: &file_path,
                // Gains Range-based resume "for free" from the shared
                // downloader; previously this always started from scratch.
                resume: true,
                chunk_timeout: None,
            },
            &self.download_guard,
            model_name,
            move |downloaded, total, _speed_mbps| {
                let progress = if total > 0 {
                    ((downloaded as f64 / total as f64) * 100.0).min(100.0) as u8
                } else {
                    0
                };

                if let Ok(mut models) = models_for_progress.try_write() {
                    if let Some(model_info) = models.get_mut(&model_name_for_progress) {
                        model_info.status = ModelStatus::Downloading { progress };
                    }
                }

                if let Some(ref callback) = progress_callback {
                    callback(progress);
                }
            },
        )
        .await;

        match result {
            Ok(outcome) => {
                log::info!(
                    "Download completed for model: {} ({} bytes{})",
                    model_name,
                    outcome.downloaded_bytes,
                    if outcome.resumed { ", resumed" } else { "" }
                );

                // Validate the completed file's header before trusting it as
                // usable (reuses the same GGML/GGUF magic-number check
                // discover_models runs).
                if let Err(e) = validate_model_file_magic(&file_path) {
                    log::warn!("Downloaded model {} failed validation: {}", model_name, e);
                    if let Err(remove_err) = fs::remove_file(&file_path).await {
                        log::warn!("Failed to clean up invalid download file: {}", remove_err);
                    }
                    {
                        let mut models = self.available_models.write().await;
                        if let Some(model_info) = models.get_mut(model_name) {
                            model_info.status = ModelStatus::Missing;
                        }
                    }
                    self.download_guard.finish(model_name).await;
                    return Err(anyhow!(
                        "Downloaded model {} failed validation: {}",
                        model_name,
                        e
                    ));
                }

                // Update model status to available
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model_info) = models.get_mut(model_name) {
                        model_info.status = ModelStatus::Available;
                        model_info.path = file_path.clone();
                    }
                }

                self.download_guard.finish(model_name).await;
                Ok(())
            }
            Err(e) => {
                self.download_guard.finish(model_name).await;

                if crate::utils::download::is_cancelled(&e) {
                    // Status is already reset by cancel_download() (which
                    // runs concurrently to set it); nothing else to do here.
                    return Err(anyhow!("Download cancelled by user"));
                }

                // Any other failure (bad HTTP status, network error, stalled
                // stream, truncated download) leaves the model retryable
                // instead of stuck showing "Downloading".
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model_info) = models.get_mut(model_name) {
                        model_info.status = ModelStatus::Missing;
                    }
                }
                Err(e)
            }
        }
    }

    pub async fn cancel_download(&self, model_name: &str) -> Result<()> {
        log::info!("Cancelling download for model: {}", model_name);

        // Set cancellation flag to interrupt the download loop
        self.download_guard.request_cancel(model_name).await;

        // Update model status to Missing (so it can be retried)
        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::Missing;
            }
        }

        // Clean up partially downloaded files
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await; // Brief delay to let download loop detect cancellation

        let filename = format!("ggml-{}.bin", model_name);
        let file_path = self.models_dir.join(&filename);
        if file_path.exists() {
            if let Err(e) = fs::remove_file(&file_path).await {
                log::warn!("Failed to clean up cancelled download file: {}", e);
            } else {
                log::info!(
                    "Cleaned up cancelled download file: {}",
                    file_path.display()
                );
            }
        }

        Ok(())
    }
}
