# Q3 Roadmap Sync

## Attendees

- Alice Chen (Product)
- Bob Okafor (Engineering)
- Priya Raman (Design)

## Meeting Summary

The team reviewed **Q3 priorities** and agreed the *GPUI spike* should ship
before the broader rewrite decision is made. Bob noted the current Tauri +
React stack is "fine, but heavier than it needs to be" and flagged
`AudioMixerRingBuffer` as a good stress test for a native-first UI.

### Key Decisions

1. Ship the GPUI spike behind `enhance/gpui-spike` -- no changes to `frontend/`.
2. Evaluate `zorite-editor` for the summary/notes surface.
3. Revisit the rewrite-vs-iterate decision once the spike lands.

## Action Items

- [x] Draft spike scope doc
  - [x] List the four checks (shell, transcript, summary, tray)
  - [x] Pin research clones under `scratchpad/research`
- [ ] Build the spike crate
  - [x] Cargo workspace isolation (`spikes/gpui-shell`)
  - [ ] Live transcript view with `MessageScrollerState`
  - [ ] Summary editor with `zorite-editor`
  - [ ] Tray via `gpui-tray`
- [ ] Write up findings
  - [ ] Build time + binary size
  - [ ] Round-trip diff report

## Feature Comparison

| Area | Tauri + React (today) | GPUI spike |
| --- | --- | --- |
| Process model | Webview + Rust core | Single native process |
| Startup | ~1-2s cold | TBD, measure cold build/run |
| Audio -> UI | Tauri events (`emit`) | `Arc<AtomicU32>` read on paint |
| Rich text | Markdown-it in React | `zorite-editor` (WYSIWYG) |

> Reminder: the spike must not touch `frontend/`, the root workspace
> members, or the root `Cargo.lock`. It lives entirely under
> `spikes/gpui-shell/` with its own `[workspace]` table.

Inline code like `cargo build --release` and `RUST_LOG=debug` should render
as monospace. See also the `AudioMixerRingBuffer` pairing logic referenced
above for the 50ms window alignment.
