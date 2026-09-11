//! "Appearance" settings page: light/dark/system theme.
//!
//! `Theme::change` is gpui-kit's own in-memory switch. The chosen mode is
//! now also persisted under `KEY_THEME_PREFERENCE` (new — the React app's
//! theme lives in browser `localStorage`, outside SQLite, so this key has
//! no legacy predecessor) via `state::save_theme_pref`, so it survives a
//! restart. `apply_saved_theme` applies the saved value at startup — call
//! it once after the DB pool is available (`main.rs` owns that wiring, out
//! of this package's scope; noted in the phase report instead of wired
//! here).

use gpui_kit::component::{
    setting::{SettingField, SettingGroup, SettingItem, SettingPage},
    IconName, Theme, ThemeMode,
};
use gpui_kit::*;

use super::state::SettingsCache;

pub fn page(_view: &Entity<super::SettingsView>, _cx: &mut Context<super::SettingsView>) -> SettingPage {
    SettingPage::new("Appearance")
        .icon(IconName::Palette)
        .group(SettingGroup::new().title("Theme").items(vec![
            SettingItem::new(
                "Theme",
                SettingField::dropdown(
                    vec![
                        (SharedString::from("system"), SharedString::from("Follow system")),
                        (SharedString::from("light"), SharedString::from("Light")),
                        (SharedString::from("dark"), SharedString::from("Dark")),
                    ],
                    |cx: &App| {
                        let pref = SettingsCache::global(cx).theme_pref.clone();
                        SharedString::from(if pref.is_empty() { "system".to_string() } else { pref })
                    },
                    |val: SharedString, cx: &mut App| {
                        let mode_str = val.to_string();
                        apply_theme_mode(&mode_str, cx);
                        super::state::save_theme_pref(cx, mode_str);
                    },
                ),
            )
            .description("Applied immediately and remembered for next launch."),
        ]))
}

/// Switch `Theme`'s in-memory mode to match `mode` ("light"/"dark"/"system").
/// "system" falls back to dark — `gpui-kit`'s `Theme::change` takes an
/// explicit mode; wiring actual OS theme detection is out of this page's
/// scope (there's no such signal plumbed into `meetily-gpui` yet).
fn apply_theme_mode(mode: &str, cx: &mut App) {
    let theme_mode = match mode {
        "light" => ThemeMode::Light,
        _ => ThemeMode::Dark,
    };
    Theme::change(theme_mode, None, cx);
}

/// Apply the theme preference saved under `KEY_THEME_PREFERENCE`, if any.
/// Meant to be called once at startup after `SettingsCache` has loaded
/// (i.e. after `state::load` has run) — `main.rs` (owned by another
/// package in this phase) should call this once the DB pool is ready, e.g.
/// right after constructing the first window.
// Not called anywhere in this package yet — `main.rs` (owned by another
// package) needs to call it once after the DB pool + `SettingsCache` are
// ready. `#[allow(dead_code)]` keeps `cargo build -p meetily-gpui` warning-free
// until that wiring lands; remove once `main.rs` calls it.
#[allow(dead_code)]
pub fn apply_saved_theme(cx: &mut App) {
    if !cx.has_global::<SettingsCache>() {
        return;
    }
    let pref = SettingsCache::global(cx).theme_pref.clone();
    if pref.is_empty() {
        return;
    }
    apply_theme_mode(&pref, cx);
}
