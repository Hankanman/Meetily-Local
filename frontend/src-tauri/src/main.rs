#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use env_logger;
use log;

fn main() {
    // Honor RUST_LOG from the environment (dev.sh sets `info,whisper_rs=warn`)
    // and default to `info` if unset. The `filter_module` call clamps
    // `whisper_rs` to Warn regardless — whisper.cpp emits ~1000 lines of
    // per-decoder beam-search trace at INFO that drowns out everything else.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .filter_module("whisper_rs", log::LevelFilter::Warn)
        .init();

    // On Linux, WebKitGTK's DMABUF renderer is unreliable on common GPU/driver
    // combinations (notably NVIDIA proprietary drivers and several Wayland
    // compositors), producing a blank white window on launch. Disabling DMABUF
    // falls back to the stable renderer and fixes the blank-window case with
    // negligible visual/performance cost for a desktop app of this scope.
    // Only set the flag if the user hasn't already chosen a value, so anyone
    // debugging WebKit rendering can still override it from the environment.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    // Async logger will be initialized lazily when first needed (after Tauri runtime starts)
    log::info!("Starting application...");
    app_lib::run();
}
