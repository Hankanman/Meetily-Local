//! Top-level window content: title bar, sidebar navigation, and the routed
//! page. Each page is its own entity in `views/`; the shell owns them so
//! their state (e.g. the live transcript) survives navigating away.

use gpui_kit::component::{
    ActiveTheme, IconName, TitleBar, h_flex, v_flex,
    sidebar::{Sidebar, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuItem},
};
use gpui_kit::*;

use crate::views::{meeting::MeetingView, recording::RecordingView, settings::SettingsView};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    Recording,
    Meeting(String),
    Settings,
}

/// Lets any view switch pages without holding the shell: `navigate(Route::Meeting(id), cx)`.
struct Navigator(WeakEntity<AppShell>);

impl Global for Navigator {}

pub fn navigate(route: Route, cx: &mut App) {
    let Some(shell) = cx.try_global::<Navigator>().map(|n| n.0.clone()) else {
        return;
    };
    let _ = shell.update(cx, |shell, cx| shell.navigate(route, cx));
}

pub struct AppShell {
    route: Route,
    recording: Entity<RecordingView>,
    meeting: Entity<MeetingView>,
    settings: Entity<SettingsView>,
}

impl AppShell {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        cx.set_global(Navigator(cx.entity().downgrade()));
        Self {
            route: Route::Recording,
            recording: cx.new(|cx| RecordingView::new(window, cx)),
            meeting: cx.new(|cx| MeetingView::new(window, cx)),
            settings: cx.new(|cx| SettingsView::new(window, cx)),
        }
    }

    pub fn navigate(&mut self, route: Route, cx: &mut Context<Self>) {
        if let Route::Meeting(id) = &route {
            let id = id.clone();
            self.meeting.update(cx, |view, cx| view.load(id, cx));
        }
        self.route = route;
        cx.notify();
    }

    fn nav_item(
        &self,
        label: &'static str,
        icon: IconName,
        route: Route,
        cx: &mut Context<Self>,
    ) -> SidebarMenuItem {
        let this = cx.entity();
        SidebarMenuItem::new(label)
            .icon(icon)
            .active(self.route == route)
            .on_click(move |_, _, cx| {
                let route = route.clone();
                this.update(cx, |shell, cx| shell.navigate(route, cx));
            })
    }
}

impl Render for AppShell {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let page: AnyView = match &self.route {
            Route::Recording => self.recording.clone().into(),
            Route::Meeting(_) => self.meeting.clone().into(),
            Route::Settings => self.settings.clone().into(),
        };

        let sidebar = Sidebar::new("app-sidebar")
            .header(SidebarHeader::new().child("Parley"))
            .child(
                SidebarGroup::new("Meetings").child(SidebarMenu::new().children([
                    self.nav_item("Record", IconName::Play, Route::Recording, cx),
                    self.nav_item("Settings", IconName::Settings, Route::Settings, cx),
                ])),
            );

        v_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(TitleBar::new().child("Parley"))
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .child(sidebar)
                    .child(div().flex_1().min_w_0().h_full().child(page)),
            )
    }
}
