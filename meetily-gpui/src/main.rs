//! Parley desktop app on GPUI. Links `meetily-core` directly — no webview,
//! no IPC. Startup and shutdown are shared with the Tauri shell through
//! `meetily_core::bootstrap`.

mod app_state;
mod core_events;
mod runtime;
mod shell;
mod views;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use gpui_kit::component::{Root, TitleBar};
use gpui_kit::*;
use meetily_core::bootstrap;
use meetily_core::database::setup::StartupOutcome;
use meetily_core::events::SharedEventSink;

use app_state::AppServices;
use core_events::CoreEvents;
use runtime::Io;
use shell::AppShell;

/// Set once a close/quit request has started finishing the recording, so a
/// second request (mashing close, or close + tray Quit) doesn't start another.
static QUIT_STARTED: AtomicBool = AtomicBool::new(false);

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(
        "info,whisper_rs=warn,zbus=warn,tracing=warn,wgpu_hal=warn,wgpu_core=warn,naga=warn",
    ))
    .init();

    let io = Io::new().expect("failed to start the tokio runtime");
    let (sink, events_rx) = core_events::channel();
    let sink: SharedEventSink = Arc::new(sink);

    // Same order as the Tauri shell: paths, then the database (blocking, so
    // everything after it sees the pool), then background init with the pool.
    bootstrap::init_paths();
    let db = match io.block_on(bootstrap::prepare_database()) {
        Ok(StartupOutcome::Initialized(db)) => Some(db),
        Ok(StartupOutcome::FirstLaunch) => {
            log::warn!("First launch: no database yet — complete onboarding in the Tauri app for now");
            None
        }
        Err(e) => {
            log::error!("Database startup failed: {}", e);
            None
        }
    };
    let model_manager = Arc::new(tokio::sync::Mutex::new(None));
    {
        let _guard = io.handle().enter();
        bootstrap::spawn_background_init(
            sink.clone(),
            db.as_ref().map(|db| db.pool().clone()),
            model_manager,
        );
    }

    let app = gpui_kit::application()
        .with_assets(gpui_kit::assets::Assets)
        .with_quit_mode(QuitMode::Explicit);

    let db_for_shutdown = db.clone();
    let io_for_shutdown = io.clone();
    app.run(move |cx| {
        gpui_kit::init(cx);

        let core_events = cx.new(|cx| CoreEvents::new(events_rx, cx));
        cx.set_global(io.clone());
        cx.set_global(AppServices {
            io: io.clone(),
            sink: sink.clone(),
            core_events,
            db,
        });

        let mut window_options = TitleBar::window_options();
        window_options.window_bounds = Some(WindowBounds::centered(size(px(1100.), px(720.)), cx));
        window_options.window_decorations = Some(WindowDecorations::Client);

        cx.spawn(async move |cx| {
            let window = cx
                .open_window(window_options, |window, cx| {
                    let view = cx.new(|cx| AppShell::new(window, cx));
                    cx.new(|cx| Root::new(view, window, cx))
                })
                .expect("failed to open window");

            let _ = window.update(cx, |_, window, cx| {
                window.on_window_should_close(cx, |_, cx| {
                    request_quit(cx);
                    false
                });
            });
        })
        .detach();
    });

    // The run loop has exited: release the DB, sidecar and Whisper model.
    io_for_shutdown.block_on(bootstrap::shutdown(db_for_shutdown.as_ref()));
    log::info!("Application cleanup complete");

    // Exit immediately, skipping C/C++ static destructors — same reason as
    // the Tauri shell (GPU driver / whisper.cpp teardown can crash on exit).
    unsafe { libc::_exit(0) };
}

/// Finish any active recording (full stop flow, so nothing unflushed is
/// lost), then quit. Shared by window close and the tray's Quit.
pub fn request_quit(cx: &mut App) {
    if QUIT_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let services = AppServices::global(cx);
    let io = services.io.clone();
    let ctx = services.recording_context();
    cx.spawn(async move |cx| {
        let _ = io.spawn(bootstrap::finish_recording_for_exit(ctx)).await;
        cx.update(|cx| cx.quit());
    })
    .detach();
}
