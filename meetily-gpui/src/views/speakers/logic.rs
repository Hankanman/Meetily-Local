//! Pure logic for the Speakers page: which stored voice profiles to show,
//! in what order, and who a given profile can be merged into. Mirrors
//! `frontend/src/components/SpeakerSettings.tsx`.

use chrono::{DateTime, Utc};
use meetily_core::database::models::VoiceProfile;

/// Profiles the page lists: every stored profile except the self-enrolled
/// one (that's owned by a separate "Your voice" enrollment flow this page
/// doesn't implement — see the module doc comment in `mod.rs`), sorted
/// alphabetically by name, case-insensitively.
pub fn visible_profiles(profiles: &[VoiceProfile]) -> Vec<&VoiceProfile> {
    let mut visible: Vec<&VoiceProfile> = profiles.iter().filter(|p| !p.is_self).collect();
    visible.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    visible
}

/// Everyone `loser_id` could be merged into: every visible profile except
/// itself.
pub fn merge_candidates<'a>(visible: &[&'a VoiceProfile], loser_id: &str) -> Vec<&'a VoiceProfile> {
    visible.iter().copied().filter(|p| p.id != loser_id).collect()
}

/// Best-effort relative date for the "Updated" column, e.g. "11 Sep 2026".
/// Falls back to the raw string on parse failure (matches the frontend's
/// `formatRelative`).
pub fn format_updated(iso: &str) -> String {
    match DateTime::parse_from_rfc3339(iso) {
        Ok(dt) => dt.with_timezone(&Utc).format("%-d %b %Y").to_string(),
        Err(_) => iso.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, name: &str, is_self: bool) -> VoiceProfile {
        VoiceProfile {
            id: id.to_string(),
            name: name.to_string(),
            email: None,
            embedding: Vec::new(),
            embedding_dim: 0,
            sample_count: 0,
            is_self,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn excludes_the_self_profile() {
        let profiles = vec![profile("1", "Me", true), profile("2", "Bob", false)];
        let visible = visible_profiles(&profiles);
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].id, "2");
    }

    #[test]
    fn sorts_case_insensitively_by_name() {
        let profiles = vec![profile("1", "bob", false), profile("2", "Alice", false)];
        let visible = visible_profiles(&profiles);
        assert_eq!(visible.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["2", "1"]);
    }

    #[test]
    fn merge_candidates_excludes_the_loser() {
        let profiles = vec![profile("1", "Alice", false), profile("2", "Bob", false)];
        let visible = visible_profiles(&profiles);
        let candidates = merge_candidates(&visible, "1");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, "2");
    }

    #[test]
    fn format_updated_parses_rfc3339() {
        assert_eq!(format_updated("2026-07-15T10:30:00Z"), "15 Jul 2026");
    }

    #[test]
    fn format_updated_falls_back_on_parse_failure() {
        assert_eq!(format_updated("not-a-date"), "not-a-date");
    }
}
