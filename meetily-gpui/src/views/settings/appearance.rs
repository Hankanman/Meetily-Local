//! "Appearance" settings page: light/dark/system theme.
//!
//! `Theme::change` is gpui-kit's own in-memory switch; there's no
//! database-backed "theme" setting on the core/Tauri side to mirror
//! (the React app's theme lives in browser `localStorage`, outside SQLite),
//! so this is session-only for now — noted as a deferred item in the phase
//! 1 report rather than invented.

use gpui_kit::component::{
    setting::{SettingField, SettingGroup, SettingItem, SettingPage},
    ActiveTheme, IconName, Theme, ThemeMode,
};
use gpui_kit::*;

pub fn page(_view: &Entity<super::SettingsView>, _cx: &mut Context<super::SettingsView>) -> SettingPage {
    SettingPage::new("Appearance")
        .icon(IconName::Palette)
        .group(SettingGroup::new().title("Theme").items(vec![
            SettingItem::new(
                "Dark mode",
                SettingField::switch(
                    |cx: &App| cx.theme().mode.is_dark(),
                    |val: bool, cx: &mut App| {
                        let mode = if val { ThemeMode::Dark } else { ThemeMode::Light };
                        Theme::change(mode, None, cx);
                    },
                )
                .default_value(false),
            )
            .description("Switch between light and dark themes for this session."),
        ]))
}
