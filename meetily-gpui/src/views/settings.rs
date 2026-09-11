//! Settings page. Placeholder — filled in by the Phase 1 work packages.

use gpui_kit::*;

pub struct SettingsView;

impl SettingsView {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self
    }
}

impl Render for SettingsView {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().p_4().child("Settings")
    }
}
