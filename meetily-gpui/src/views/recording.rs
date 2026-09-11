//! Recording page. Placeholder — filled in by the Phase 1 work packages.

use gpui_kit::*;

pub struct RecordingView;

impl RecordingView {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self
    }
}

impl Render for RecordingView {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().p_4().child("Recording")
    }
}
