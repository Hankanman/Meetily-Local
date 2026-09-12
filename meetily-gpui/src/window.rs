//! Opening (and re-opening) the main window.
//!
//! Startup and the tray's "Open Parley" both go through [`open_main_window`]
//! so the window is always set up identically: saved theme applied, the
//! close handler registered, and the [`crate::tray::MainWindow`] global
//! pointed at the live handle.
//!
//! Re-opening matters because the window can genuinely go away while the app
//! keeps running: the app uses `QuitMode::Explicit`, so closing the last
//! window doesn't quit, and GPUI's Wayland backend closes a window outright
//! when no `should_close` callback is registered. Without a way back, the
//! app becomes a tray-only zombie ("window not found" from Open Parley).

use gpui_kit::component::{Root, TitleBar};
use gpui_kit::*;

use crate::root::RootView;

/// Open the main window, register its handlers, and store the handle in the
/// `MainWindow` global. Returns the new handle.
pub fn open_main_window(cx: &mut App) -> Result<WindowHandle<Root>> {
    let mut options = TitleBar::window_options();
    options.window_bounds = Some(WindowBounds::centered(size(px(1100.), px(720.)), cx));
    options.window_decorations = Some(WindowDecorations::Client);

    let window = cx.open_window(options, |window, cx| {
        let view = cx.new(|cx| RootView::new(window, cx));
        cx.new(|cx| Root::new(view, window, cx))
    })?;

    // Registering the close handler is not optional: it's what turns a close
    // request into "finish the active recording, then quit" instead of the
    // Wayland default of destroying the window (which leaves the app running
    // with only a tray). Loud on failure — silence here is what hid exactly
    // that bug.
    if let Err(e) = window.update(cx, |_, window, cx| {
        crate::views::settings::init_theme(window, cx);
        window.on_window_should_close(cx, |_, cx| {
            crate::request_quit(cx);
            // Never let the compositor destroy the window: `request_quit`
            // finishes any recording and then quits the whole app.
            false
        });
    }) {
        log::error!(
            "Failed to register main-window handlers ({e}); closing the window \
             would skip finishing an active recording"
        );
    }

    cx.set_global(crate::tray::MainWindow(window));
    Ok(window)
}

/// The live main window, re-opening it if it has gone away. `None` only if
/// opening a window failed outright.
pub fn ensure_main_window(cx: &mut App) -> Option<WindowHandle<Root>> {
    if let Some(handle) = cx.try_global::<crate::tray::MainWindow>().map(|main| main.0) {
        // `is_window_active` is just a cheap liveness probe here: it errors
        // when the handle's window is no longer in the app's window map.
        if handle.update(cx, |_, _, _| ()).is_ok() {
            return Some(handle);
        }
        log::info!("Main window was closed; re-opening it");
    }

    match open_main_window(cx) {
        Ok(handle) => Some(handle),
        Err(e) => {
            log::error!("Failed to open the main window: {}", e);
            None
        }
    }
}
