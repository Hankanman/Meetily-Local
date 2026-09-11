//! Check 4: a StatusNotifierItem tray via `gpui-tray`, with Start/Stop
//! recording (toggles shared state the UI also reflects), Show window, Quit.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

// `Menu`/`MenuItem`/`NoAction`/`actions!`/`Global` are gpui-pre's own types,
// re-exported through gpui-kit's top-level glob (`pub use ::gpui::*`) so the
// tray menu shares the same gpui-pre as the rest of the app.
use gpui_kit::*;
use gpui_tray::{Icon, Tray};

actions!(
    gpui_spike_tray,
    [TrayStartRecording, TrayStopRecording, TrayShowWindow, TrayQuit]
);

/// Recording state shared between the tray menu and the main window's UI.
/// A real app would drive this from `recording_manager`; here it's just a
/// flag both sides read/write so the spike can show the round trip.
#[derive(Clone)]
pub struct SharedRecordingState(pub Arc<AtomicBool>);

impl SharedRecordingState {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn is_recording(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    pub fn set(&self, recording: bool) {
        self.0.store(recording, Ordering::Relaxed);
    }
}

impl Global for SharedRecordingState {}

pub struct AppTray {
    tray: Tray,
}

impl Global for AppTray {}

/// Build the tray icon: a simple filled red circle. gpui-tray supports
/// `Tray::set_icon` for a live-updating icon; out of scope for the spike.
fn spike_icon() -> gpui_tray::Result<Icon> {
    const SIZE: u32 = 32;
    let mut rgba = vec![0_u8; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as i32 - 15;
            let dy = y as i32 - 15;
            if dx * dx + dy * dy <= 13 * 13 {
                let offset = ((y * SIZE + x) * 4) as usize;
                rgba[offset..offset + 4].copy_from_slice(&[220, 70, 70, 255]);
            }
        }
    }
    Icon::from_rgba(rgba, SIZE, SIZE)
}

// gpui-tray's `menu-state` cargo feature (enabled in this crate's Cargo.toml)
// is what makes `gpui::MenuItem::checked`/`disabled` available at all —
// unlike gpui-tray's own example, this crate always wants that, so no
// feature-gating is needed here.
fn checked(item: MenuItem, checked: bool) -> MenuItem {
    item.checked(checked)
}

fn disabled(item: MenuItem, disabled: bool) -> MenuItem {
    item.disabled(disabled)
}

fn build_menu(cx: &mut App) -> Vec<MenuItem> {
    let recording = cx.global::<SharedRecordingState>().is_recording();
    vec![
        disabled(
            MenuItem::action(
                if recording { "Recording…" } else { "Not recording" },
                NoAction,
            ),
            true,
        ),
        MenuItem::separator(),
        disabled(
            MenuItem::action("Start recording", TrayStartRecording),
            recording,
        ),
        checked(
            disabled(
                MenuItem::action("Stop recording", TrayStopRecording),
                !recording,
            ),
            recording,
        ),
        MenuItem::separator(),
        MenuItem::action("Show window", TrayShowWindow),
        MenuItem::action("Quit", TrayQuit),
    ]
}

/// Register tray actions + build the tray. Call once at startup, after a
/// `SharedRecordingState` global has been installed.
pub fn install(cx: &mut App, show_window: impl Fn(&mut App) + 'static) -> gpui_tray::Result<()> {
    cx.on_action(|_: &TrayStartRecording, cx: &mut App| {
        cx.global::<SharedRecordingState>().set(true);
        log::info!("tray: start recording");
        refresh(cx);
    });
    cx.on_action(|_: &TrayStopRecording, cx: &mut App| {
        cx.global::<SharedRecordingState>().set(false);
        log::info!("tray: stop recording");
        refresh(cx);
    });
    cx.on_action(move |_: &TrayShowWindow, cx: &mut App| {
        log::info!("tray: show window");
        show_window(cx);
    });
    cx.on_action(|_: &TrayQuit, cx: &mut App| {
        log::info!("tray: quit");
        if let Some(tray) = cx.try_global::<AppTray>() {
            let tray = tray.tray.clone();
            let _ = tray.close(cx);
        }
        cx.quit();
    });

    let tray = Tray::builder()
        .icon(spike_icon()?)
        .title("Parley (spike)")
        .tooltip("Parley GPUI spike")
        .menu(build_menu)
        .build(cx)?;

    cx.set_global(AppTray { tray });
    Ok(())
}

/// Refresh the tray menu's checked/disabled state, e.g. after the UI (not
/// the tray) toggles recording, so the two stay in sync either direction.
pub fn refresh(cx: &mut App) {
    if let Some(tray) = cx.try_global::<AppTray>() {
        let tray = tray.tray.clone();
        let _ = tray.refresh_menu(cx);
    }
}
