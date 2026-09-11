//! Meeting page. Placeholder — filled in by the Phase 1 work packages.

use gpui_kit::*;

pub struct MeetingView;

impl MeetingView {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self
    }
}

impl Render for MeetingView {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().p_4().child("Meeting")
    }
}

impl MeetingView {
    /// Show the meeting with `id` (called by the shell on navigation).
    pub fn load(&mut self, _id: String, cx: &mut Context<Self>) {
        cx.notify();
    }
}
