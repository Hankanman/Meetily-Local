//! Top-level window content: title bar, sidebar navigation, and the routed
//! page. Each page is its own entity in `views/`; the shell owns them so
//! their state (e.g. the live transcript) survives navigating away.

mod meeting_list;

use chrono::Local;
use gpui_kit::component::{
    ActiveTheme, IconName, TitleBar, h_flex, v_flex,
    input::{Input, InputEvent, InputState},
    sidebar::{Sidebar, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuItem},
};
use gpui_kit::*;
use meetily_core::database::models::MeetingModel;
use meetily_core::database::repositories::meeting::MeetingsRepository;

use crate::app_state::AppServices;
use crate::runtime::Io;
use crate::views::{import, meeting::MeetingView, recording::RecordingView, settings::SettingsView};
use meeting_list::MeetingRow;

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

/// Lets any view ask the sidebar to reload its meeting list — e.g. after a
/// title rename, a delete, or a summary generation finishing (none of those
/// have a dedicated core event; recording/import/retranscription events are
/// consumed directly from `core_events`, see [`AppShell::new`]).
struct Refresher(WeakEntity<AppShell>);

impl Global for Refresher {}

pub fn refresh_meetings(cx: &mut App) {
    let Some(shell) = cx.try_global::<Refresher>().map(|n| n.0.clone()) else {
        return;
    };
    let _ = shell.update(cx, |shell, cx| shell.load_meetings(cx));
}

/// Core events that mean the meeting list may be stale and should be
/// reloaded. Mirrors what the React sidebar listens to
/// (`components/Sidebar/SidebarProvider.tsx`).
const REFRESH_EVENTS: &[&str] = &[
    "recording-started",
    "recording-stopped",
    "meeting-refined",
    "import-complete",
    "retranscription-complete",
];

pub struct AppShell {
    route: Route,
    recording: Entity<RecordingView>,
    meeting: Entity<MeetingView>,
    settings: Entity<SettingsView>,
    meetings: Vec<MeetingRow>,
    meetings_loading: bool,
    search: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}

impl AppShell {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        cx.set_global(Navigator(cx.entity().downgrade()));
        cx.set_global(Refresher(cx.entity().downgrade()));

        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search meetings…"));
        let mut subscriptions = vec![cx.subscribe(&search, |_this, _, event, cx| {
            if matches!(event, InputEvent::Change) {
                cx.notify();
            }
        })];

        let core_events = AppServices::global(cx).core_events.clone();
        subscriptions.push(cx.subscribe(&core_events, |this, _, event, cx| {
            if REFRESH_EVENTS.contains(&event.name.as_str()) {
                this.load_meetings(cx);
            }
        }));

        let mut shell = Self {
            route: Route::Recording,
            recording: cx.new(|cx| RecordingView::new(window, cx)),
            meeting: cx.new(|cx| MeetingView::new(window, cx)),
            settings: cx.new(|cx| SettingsView::new(window, cx)),
            meetings: Vec::new(),
            meetings_loading: false,
            search,
            _subscriptions: subscriptions,
        };
        shell.load_meetings(cx);
        shell
    }

    pub fn navigate(&mut self, route: Route, cx: &mut Context<Self>) {
        if let Route::Meeting(id) = &route {
            let id = id.clone();
            self.meeting.update(cx, |view, cx| view.load(id, cx));
        }
        self.route = route;
        cx.notify();
    }

    /// (Re)load the meeting list from the database, replacing what's shown.
    /// Cheap enough to call on every relevant core event / mutation — the
    /// sidebar only ever holds id/title/created_at, not transcripts.
    fn load_meetings(&mut self, cx: &mut Context<Self>) {
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        self.meetings_loading = true;
        cx.notify();

        let io = Io::global(cx);
        cx.spawn(async move |this, cx| {
            let result = io
                .spawn(async move { MeetingsRepository::get_meetings(&pool).await })
                .await;

            let rows: Vec<MeetingRow> = match result {
                Ok(Ok(models)) => {
                    log::info!("Loaded {} meeting(s) for the sidebar", models.len());
                    models.into_iter().map(meeting_row).collect()
                }
                Ok(Err(e)) => {
                    log::error!("Failed to load meetings: {e}");
                    Vec::new()
                }
                Err(e) => {
                    log::error!("Meeting list load task panicked: {e}");
                    Vec::new()
                }
            };

            let _ = this.update(cx, |this, cx| {
                this.meetings = rows;
                this.meetings_loading = false;
                cx.notify();
            });
        })
        .detach();
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

    fn meeting_item(&self, meeting: &MeetingRow, cx: &mut Context<Self>) -> SidebarMenuItem {
        let this = cx.entity();
        let id = meeting.id.clone();
        let active = matches!(&self.route, Route::Meeting(active_id) if *active_id == meeting.id);
        let label = if meeting.title.trim().is_empty() {
            "Untitled meeting".to_string()
        } else {
            meeting.title.clone()
        };
        SidebarMenuItem::new(label)
            .icon(IconName::FileText)
            .active(active)
            .on_click(move |_, _, cx| {
                let id = id.clone();
                this.update(cx, |shell, cx| shell.navigate(Route::Meeting(id), cx));
            })
    }
}

fn meeting_row(model: MeetingModel) -> MeetingRow {
    MeetingRow {
        id: model.id,
        title: model.title,
        created_at: model.created_at.0,
    }
}

impl Render for AppShell {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let page: AnyView = match &self.route {
            Route::Recording => self.recording.clone().into(),
            Route::Meeting(_) => self.meeting.clone().into(),
            Route::Settings => self.settings.clone().into(),
        };

        let query = self.search.read(cx).value().to_string();
        let filtered: Vec<MeetingRow> = meeting_list::filter_by_title(&self.meetings, &query)
            .into_iter()
            .cloned()
            .collect();
        let grouped = meeting_list::group_meetings(Local::now(), &filtered);

        let mut sidebar = Sidebar::new("app-sidebar")
            .header(
                SidebarHeader::new()
                    .child(v_flex().w_full().gap_2().child("Parley").child(
                        Input::new(&self.search).prefix(IconName::Search.view(cx)),
                    )),
            )
            .child(
                SidebarGroup::new("Meetings").child(SidebarMenu::new().children([
                    self.nav_item("Record", IconName::Play, Route::Recording, cx),
                    SidebarMenuItem::new("Import audio")
                        .icon(gpui_kit::assets::IconName::Upload)
                        .on_click(|_, window, cx| import::open(window, cx)),
                    self.nav_item("Settings", IconName::Settings, Route::Settings, cx),
                ])),
            );

        for (label, meetings) in &grouped {
            let items: Vec<SidebarMenuItem> =
                meetings.iter().map(|m| self.meeting_item(m, cx)).collect();
            sidebar = sidebar.child(SidebarGroup::new(*label).child(SidebarMenu::new().children(items)));
        }

        if !self.meetings_loading && grouped.is_empty() && !query.trim().is_empty() {
            sidebar = sidebar.child(
                SidebarGroup::new("").child(SidebarMenu::new().children([SidebarMenuItem::new(
                    "No matching meetings",
                )
                .disable(true)])),
            );
        }

        v_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            // Drag-and-drop an audio file onto the window to import it —
            // mirrors `frontend/src/components/bridges/FileDropBridge.tsx`.
            .on_drop(move |paths: &ExternalPaths, window, cx| {
                if let Some(path) = import::pick_dropped_audio_file(paths.paths()) {
                    import::open_with_file(window, cx, path.clone());
                }
            })
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
