//! Pure logic for the per-segment speaker chip's edit flow — mirrors
//! `frontend/src/components/EditableSpeakerChip.tsx` and
//! `frontend/src/lib/voice-profiles.ts`'s `isUnnamedSpeakerLabel`.
//!
//! Kept free of GPUI/entity types so it's unit-testable without a window.

/// Mirrors the React component's `/^Speaker\s+\d+$/` regex: "Speaker" then
/// one or more whitespace chars then one or more ASCII digits, and nothing
/// else (after trimming).
pub fn is_unnamed_speaker_label(label: &str) -> bool {
    let trimmed = label.trim();
    let Some(rest) = trimmed.strip_prefix("Speaker") else {
        return false;
    };
    // Require at least one whitespace char between "Speaker" and the digits
    // (rejects "Speaker1"), then the rest must be non-empty ASCII digits.
    if !rest.starts_with(char::is_whitespace) {
        return false;
    }
    let digits = rest.trim_start();
    !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
}

/// The local user's fixed, non-editable label (never a stored profile).
pub const ME_LABEL: &str = "Me";

/// Whether clicking this chip should open the edit panel at all — mirrors
/// `EditableSpeakerChip`'s branching: "Me" and anything that's neither a
/// named profile nor an unnamed "Speaker N" cluster render as static spans.
pub fn can_edit_speaker(speaker: &str, voice_profile_id: Option<&str>) -> bool {
    if speaker == ME_LABEL {
        return false;
    }
    let is_named_profile = voice_profile_id.is_some();
    let is_unnamed_cluster = voice_profile_id.is_none() && is_unnamed_speaker_label(speaker);
    is_named_profile || is_unnamed_cluster
}

/// Mirrors `canSave` in the React component: merging into an existing
/// profile needs no new name (the target's own name/email are used), but
/// creating a profile (or renaming an existing one) needs a non-empty name.
pub fn can_save_speaker_edit(merge_target: Option<&str>, name: &str) -> bool {
    merge_target.is_some() || !name.trim().is_empty()
}

/// Panel heading, mirroring the two copies in the React popover.
pub fn edit_panel_title(is_named_profile: bool) -> &'static str {
    if is_named_profile {
        "Edit speaker"
    } else {
        "Name this speaker"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_unnamed_speaker_labels() {
        assert!(is_unnamed_speaker_label("Speaker 1"));
        assert!(is_unnamed_speaker_label("Speaker 42"));
        assert!(is_unnamed_speaker_label("  Speaker 3  "));
    }

    #[test]
    fn rejects_non_matching_labels() {
        assert!(!is_unnamed_speaker_label("Speaker"));
        assert!(!is_unnamed_speaker_label("Speaker1"));
        assert!(!is_unnamed_speaker_label("Speakers 1"));
        assert!(!is_unnamed_speaker_label("Alice"));
        assert!(!is_unnamed_speaker_label("Me"));
        assert!(!is_unnamed_speaker_label(""));
        assert!(!is_unnamed_speaker_label("Speaker 1a"));
    }

    #[test]
    fn me_is_never_editable() {
        assert!(!can_edit_speaker("Me", None));
        assert!(!can_edit_speaker("Me", Some("profile-1")));
    }

    #[test]
    fn named_profile_is_editable() {
        assert!(can_edit_speaker("Alice", Some("profile-1")));
    }

    #[test]
    fn unnamed_cluster_is_editable() {
        assert!(can_edit_speaker("Speaker 1", None));
    }

    #[test]
    fn stray_label_is_not_editable() {
        assert!(!can_edit_speaker("Unknown", None));
    }

    #[test]
    fn save_requires_name_unless_merging() {
        assert!(!can_save_speaker_edit(None, ""));
        assert!(!can_save_speaker_edit(None, "   "));
        assert!(can_save_speaker_edit(None, "Alice"));
        assert!(can_save_speaker_edit(Some("profile-1"), ""));
    }

    #[test]
    fn panel_title_depends_on_named_profile() {
        assert_eq!(edit_panel_title(true), "Edit speaker");
        assert_eq!(edit_panel_title(false), "Name this speaker");
    }
}
