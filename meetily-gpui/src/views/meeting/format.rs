//! Pure formatting helpers for the meeting page: transcript timestamps and
//! the flattened transcript text sent to summary generation. Mirrors
//! `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`'s
//! `formatTime`/`fullTranscript` so a generated summary reads the same
//! whether it was requested from the Tauri UI or this one.

use chrono::{DateTime, Utc};
use meetily_core::database::models::MeetingTranscript;

/// Recording-relative `[MM:SS]` timestamp when `audio_start_time` is known,
/// otherwise the transcript's wall-clock `timestamp` string as-is (older
/// rows / imports predate audio-relative timestamps).
pub fn segment_timestamp(audio_start_time: Option<f64>, fallback_timestamp: &str) -> String {
    match audio_start_time {
        Some(seconds) if seconds.is_finite() && seconds >= 0.0 => {
            let total = seconds.floor() as u64;
            format!("[{:02}:{:02}]", total / 60, total % 60)
        }
        _ => fallback_timestamp.to_string(),
    }
}

/// Flattens transcript segments into the plain-text transcript summary
/// generation consumes: one `<timestamp> <text>` line per segment.
pub fn build_transcript_text(transcripts: &[MeetingTranscript]) -> String {
    transcripts
        .iter()
        .map(|t| format!("{} {}", segment_timestamp(t.audio_start_time, &t.timestamp), t.text))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Header date, e.g. "11 Sep 2026, 14:03" in the meeting's local timezone.
pub fn format_header_date(created_at: DateTime<Utc>) -> String {
    created_at.with_timezone(&chrono::Local).format("%-d %b %Y, %H:%M").to_string()
}

/// Clipboard text for "Copy transcript". Mirrors
/// `frontend/src/hooks/meeting-details/useCopyOperations.ts`'s
/// `handleCopyTranscript`: a `#`/`##` header, then one `[MM:SS] Speaker: text`
/// line per segment with a trailing two-space markdown line break.
pub fn copy_transcript_text(
    meeting_id: &str,
    title: &str,
    created_at: Option<DateTime<Utc>>,
    transcripts: &[MeetingTranscript],
) -> String {
    let header = format!("# Transcript of the Meeting: {meeting_id} - {title}\n\n");
    let date = format!(
        "## Date: {}\n\n",
        created_at.map(|d| d.with_timezone(&chrono::Local).format("%-m/%-d/%Y").to_string()).unwrap_or_default()
    );
    let lines = transcripts
        .iter()
        .map(|t| {
            let time = segment_timestamp(t.audio_start_time, &t.timestamp);
            let who = t.speaker.as_ref().map(|s| format!("{s}: ")).unwrap_or_default();
            format!("{time} {who}{}  ", t.text)
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("{header}{date}{lines}")
}

/// Clipboard text for "Copy summary". Mirrors `useCopyOperations.ts`'s
/// `handleCopySummary`: a title, a metadata block (meeting id, meeting date,
/// copy time), a rule, then the summary markdown as-is.
pub fn copy_summary_text(
    meeting_id: &str,
    title: &str,
    created_at: Option<DateTime<Utc>>,
    summary_markdown: &str,
) -> String {
    let header = format!("# Meeting Summary: {title}\n\n");
    let fmt = |d: DateTime<Utc>| d.with_timezone(&chrono::Local).format("%B %-d, %Y, %I:%M %p").to_string();
    let created = created_at.map(fmt).unwrap_or_default();
    let copied = fmt(Utc::now());
    let metadata =
        format!("**Meeting ID:** {meeting_id}\n**Date:** {created}\n**Copied on:** {copied}\n\n---\n\n");
    format!("{header}{metadata}{summary_markdown}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_from_audio_start_time() {
        assert_eq!(segment_timestamp(Some(65.0), "2026-09-11T00:00:00Z"), "[01:05]");
        assert_eq!(segment_timestamp(Some(0.0), "x"), "[00:00]");
        assert_eq!(segment_timestamp(Some(3599.9), "x"), "[59:59]");
    }

    #[test]
    fn falls_back_to_wall_clock_timestamp() {
        assert_eq!(segment_timestamp(None, "2026-09-11T00:00:00Z"), "2026-09-11T00:00:00Z");
        assert_eq!(segment_timestamp(Some(-1.0), "fallback"), "fallback");
    }

    fn seg(text: &str, audio_start_time: Option<f64>) -> MeetingTranscript {
        MeetingTranscript {
            id: "1".into(),
            text: text.into(),
            timestamp: "2026-09-11T00:00:00Z".into(),
            audio_start_time,
            audio_end_time: None,
            duration: None,
            speaker: None,
            voice_profile_id: None,
            source: None,
        }
    }

    #[test]
    fn builds_one_line_per_segment() {
        let transcripts = vec![seg("Hello", Some(0.0)), seg("World", Some(65.0))];
        assert_eq!(build_transcript_text(&transcripts), "[00:00] Hello\n[01:05] World");
    }

    #[test]
    fn empty_transcript_list_is_empty_string() {
        assert_eq!(build_transcript_text(&[]), "");
    }

    #[test]
    fn copy_transcript_includes_header_date_and_speaker_lines() {
        let mut a = seg("Hello", Some(0.0));
        a.speaker = Some("Alice".to_string());
        let transcripts = vec![a, seg("World", Some(65.0))];
        let created = DateTime::parse_from_rfc3339("2026-07-15T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let text = copy_transcript_text("meeting-1", "Weekly Sync", Some(created), &transcripts);
        assert!(text.starts_with("# Transcript of the Meeting: meeting-1 - Weekly Sync\n\n"));
        assert!(text.contains("## Date:"));
        assert!(text.contains("[00:00] Alice: Hello  "));
        assert!(text.contains("[01:05] World  "));
    }

    #[test]
    fn copy_summary_includes_metadata_and_body_verbatim() {
        let created = DateTime::parse_from_rfc3339("2026-07-15T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let text = copy_summary_text("meeting-1", "Weekly Sync", Some(created), "## Key Points\n\n- Shipped");
        assert!(text.starts_with("# Meeting Summary: Weekly Sync\n\n"));
        assert!(text.contains("**Meeting ID:** meeting-1\n"));
        assert!(text.contains("**Date:**"));
        assert!(text.contains("**Copied on:**"));
        assert!(text.ends_with("---\n\n## Key Points\n\n- Shipped"));
    }
}
