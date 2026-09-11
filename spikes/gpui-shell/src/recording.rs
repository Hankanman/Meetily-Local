//! Check 2: a fake "live transcript" view using gpui-kit's
//! `MessageScrollerState` (variable-height rows, tail-following, jump-to-
//! latest) plus a two-channel level meter fed by `Arc<AtomicU32>`s that a
//! background thread updates. The UI reads those atomics only from inside
//! `render`, i.e. only while this view is actually on screen — the pattern
//! we'd use instead of a Tauri-style 60fps event stream.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use gpui_kit::component::{
    ActiveTheme, StyledExt as _, h_flex, v_flex,
    message_scroller::{MessageScroller, MessageScrollerState},
};
use gpui_kit::*;
use gpui_kit::prelude::FluentBuilder as _;
use smol::Timer;

const TRANSCRIPT_TICK: Duration = Duration::from_millis(600);
const METER_TICK: Duration = Duration::from_millis(33); // ~30fps repaint while visible

#[derive(Clone, Copy, PartialEq, Eq)]
enum Speaker {
    Microphone,
    System,
}

impl Speaker {
    fn label(self) -> &'static str {
        match self {
            Speaker::Microphone => "You",
            Speaker::System => "System audio",
        }
    }
}

struct TranscriptRow {
    speaker: Speaker,
    timestamp: String,
    text: String,
    partial: bool,
}

const SENTENCES: &[&str] = &[
    "Let's pick up where we left off on the audio pipeline.",
    "I think the ring buffer alignment is solid now.",
    "We should double check the AEC3 tuning on Bluetooth mics though.",
    "Can you share the doc after this?",
    "Sure, I'll drop it in the channel.",
    "The VAD is filtering out about seventy percent of silence, which matches what we expected.",
    "Good, that should keep Whisper's load down.",
    "One more thing — the GPUI spike build finished overnight.",
    "Nice, how's the binary size looking?",
    "Still gathering numbers, I'll have them by the end of this.",
    "Okay, let's also talk about the summary editor.",
    "Zorite handles nested task lists better than I expected.",
    "That's good news for the meeting notes feature.",
];

/// Render-only state shared with the background level-meter thread.
pub struct LevelMeter {
    mic: Arc<AtomicU32>,
    system: Arc<AtomicU32>,
}

impl LevelMeter {
    fn spawn() -> Self {
        let mic = Arc::new(AtomicU32::new(0));
        let system = Arc::new(AtomicU32::new(0));
        let tick = Arc::new(AtomicU64::new(0));

        {
            let mic = mic.clone();
            let system = system.clone();
            let tick = tick.clone();
            std::thread::Builder::new()
                .name("gpui-spike-level-meter".into())
                .spawn(move || {
                    loop {
                        let t = tick.fetch_add(1, Ordering::Relaxed) as f32 * 0.05;
                        // Fake mic level: a breathing sine with a touch of noise.
                        let mic_v = ((t.sin() * 0.5 + 0.5) * 0.8
                            + fastrand_like(t) * 0.2)
                            .clamp(0.0, 1.0);
                        // Fake system level: slower, quieter, occasional bursts.
                        let sys_v = (((t * 0.6 + 1.3).sin() * 0.5 + 0.5) * 0.5
                            + fastrand_like(t * 1.7) * 0.15)
                            .clamp(0.0, 1.0);
                        mic.store((mic_v * u32::MAX as f32) as u32, Ordering::Relaxed);
                        system.store((sys_v * u32::MAX as f32) as u32, Ordering::Relaxed);
                        std::thread::sleep(Duration::from_millis(16));
                    }
                })
                .expect("spawn level meter thread");
        }

        Self { mic, system }
    }

    fn mic_level(&self) -> f32 {
        self.mic.load(Ordering::Relaxed) as f32 / u32::MAX as f32
    }

    fn system_level(&self) -> f32 {
        self.system.load(Ordering::Relaxed) as f32 / u32::MAX as f32
    }
}

/// A cheap, dependency-free noise function (no external RNG crate needed for
/// a spike): deterministic but visually noisy.
fn fastrand_like(x: f32) -> f32 {
    let v = (x * 12.9898).sin() * 43758.5453;
    v.fract().abs()
}

pub struct RecordingView {
    rows: Vec<TranscriptRow>,
    scroller: Entity<MessageScrollerState>,
    meter: LevelMeter,
    elapsed_secs: u64,
    seed: u64,
}

impl RecordingView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let scroller = cx.new(|cx| MessageScrollerState::new(0, cx));
        let mut this = Self {
            rows: Vec::new(),
            scroller,
            meter: LevelMeter::spawn(),
            elapsed_secs: 0,
            seed: 1,
        };
        this.push_row(Speaker::Microphone, false, cx);

        // Transcript generator loop.
        cx.spawn(async move |this, cx| {
            loop {
                Timer::after(TRANSCRIPT_TICK).await;
                let result = this.update(cx, |this, cx| {
                    this.tick(cx);
                    cx.notify();
                });
                if result.is_err() {
                    break;
                }
            }
        })
        .detach();

        // Level-meter repaint loop: cheap `cx.notify()`, atomics are read in
        // `render` (i.e. only while this view is on screen).
        let _ = window;
        cx.spawn(async move |this, cx| {
            loop {
                Timer::after(METER_TICK).await;
                let result = this.update(cx, |_, cx| cx.notify());
                if result.is_err() {
                    break;
                }
            }
        })
        .detach();

        this
    }

    fn next_rand(&mut self) -> u64 {
        // xorshift64 — good enough for picking fake sentences.
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 7;
        self.seed ^= self.seed << 17;
        self.seed
    }

    fn push_row(&mut self, speaker: Speaker, partial: bool, cx: &mut Context<Self>) {
        self.elapsed_secs += 1 + (self.next_rand() % 3);
        let mins = self.elapsed_secs / 60;
        let secs = self.elapsed_secs % 60;
        let sentence_count = 1 + (self.next_rand() % 4) as usize;
        let mut text = String::new();
        for i in 0..sentence_count {
            if i > 0 {
                text.push(' ');
            }
            let idx = (self.next_rand() as usize) % SENTENCES.len();
            text.push_str(SENTENCES[idx]);
        }
        self.rows.push(TranscriptRow {
            speaker,
            timestamp: format!("{mins:02}:{secs:02}"),
            text,
            partial,
        });
        self.scroller.update(cx, |s, cx| {
            let n = self.rows.len();
            s.splice(n - 1..n - 1, 1, cx);
        });
    }

    /// Either append a new row, or mutate the last row in place (simulating
    /// Whisper's partial -> final transcript revision).
    fn tick(&mut self, cx: &mut Context<Self>) {
        let r = self.next_rand();
        let mutate_last = self
            .rows
            .last()
            .is_some_and(|row| row.partial)
            && r % 3 != 0;

        if mutate_last {
            let idx = self.rows.len() - 1;
            let extra_idx = (self.next_rand() as usize) % SENTENCES.len();
            self.rows[idx].text.push(' ');
            self.rows[idx].text.push_str(SENTENCES[extra_idx]);
            self.rows[idx].partial = r % 4 != 0;
            self.scroller
                .update(cx, |s, cx| { s.splice(idx..idx + 1, 1, cx); });
        } else {
            let speaker = if r % 2 == 0 {
                Speaker::Microphone
            } else {
                Speaker::System
            };
            let partial = r % 5 != 0;
            self.push_row(speaker, partial, cx);
        }
    }

    fn level_bar(&self, label: &'static str, level: f32) -> impl IntoElement {
        h_flex()
            .items_center()
            .gap_2()
            .child(div().w_20().text_xs().child(label))
            .child(
                div()
                    .flex_1()
                    .h_2()
                    .rounded_full()
                    .bg(gpui_kit::gpui::hsla(0., 0., 0.5, 0.15))
                    .overflow_hidden()
                    .child(
                        div()
                            .h_full()
                            .rounded_full()
                            .w(relative(level.clamp(0.0, 1.0)))
                            .bg(gpui_kit::gpui::hsla(
                                0.38 - 0.1 * level,
                                0.65,
                                0.5,
                                1.,
                            )),
                    ),
            )
    }
}

impl Render for RecordingView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mic_level = self.meter.mic_level();
        let system_level = self.meter.system_level();
        // The row renderer runs lazily during layout/paint, after this
        // method returns, so it can't borrow `self.rows` directly. Instead
        // it closes over a handle to this same entity and reads through it —
        // the standard GPUI pattern for a self-referential list.
        let this_entity = cx.entity();

        v_flex()
            .size_full()
            .gap_3()
            .p_4()
            .child(
                v_flex()
                    .gap_2()
                    .p_3()
                    .rounded(cx.theme().radius)
                    .border_1()
                    .border_color(cx.theme().border)
                    .child(div().text_sm().font_semibold().child("Levels"))
                    .child(self.level_bar("Mic", mic_level))
                    .child(self.level_bar("System", system_level)),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .rounded(cx.theme().radius)
                    .border_1()
                    .border_color(cx.theme().border)
                    .child(
                        MessageScroller::new("live-transcript", self.scroller.clone(), move |ix, _window, cx| {
                            let entity = this_entity.read(cx);
                            let row = &entity.rows[ix];
                            let (speaker_label, timestamp, text, partial) =
                                (row.speaker.label(), row.timestamp.clone(), row.text.clone(), row.partial);
                            let theme = ActiveTheme::theme(cx);
                            let accent = match entity.rows[ix].speaker {
                                Speaker::Microphone => theme.primary,
                                Speaker::System => theme.muted_foreground,
                            };
                            v_flex()
                                .gap_1()
                                .child(
                                    h_flex()
                                        .gap_2()
                                        .items_baseline()
                                        .child(
                                            div()
                                                .text_xs()
                                                .font_semibold()
                                                .text_color(accent)
                                                .child(speaker_label),
                                        )
                                        .child(
                                            div()
                                                .text_xs()
                                                .text_color(theme.muted_foreground)
                                                .child(timestamp),
                                        )
                                        .when(partial, |this| {
                                            this.child(
                                                div()
                                                    .text_xs()
                                                    .italic()
                                                    .text_color(theme.muted_foreground)
                                                    .child("(live)"),
                                            )
                                        }),
                                )
                                .child(div().text_sm().child(text))
                        })
                        .with_bottom_fade(cx.theme().background),
                    ),
            )
    }
}
