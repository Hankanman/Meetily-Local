//! Persistence for stored speaker voice profiles.
//!
//! Each profile is a (name, embedding centroid, dim, sample_count) tuple.
//! The centroid is stored as a packed little-endian f32 BLOB; the dim is
//! stored alongside so a model change can be detected at load time before
//! we feed a wrong-shaped vector to the matcher.

use crate::database::models::VoiceProfile;
use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

pub struct VoiceProfilesRepository;

impl VoiceProfilesRepository {
    pub async fn list_all(pool: &SqlitePool) -> Result<Vec<VoiceProfile>, SqlxError> {
        sqlx::query_as::<_, VoiceProfile>(
            "SELECT id, name, email, embedding, embedding_dim, sample_count, created_at, updated_at
             FROM voice_profiles
             ORDER BY name COLLATE NOCASE",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn get_by_id(
        pool: &SqlitePool,
        id: &str,
    ) -> Result<Option<VoiceProfile>, SqlxError> {
        sqlx::query_as::<_, VoiceProfile>(
            "SELECT id, name, email, embedding, embedding_dim, sample_count, created_at, updated_at
             FROM voice_profiles WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    /// Insert a new profile. `email` is optional — pass `None` if the user
    /// only provided a display name. Returns the generated id.
    pub async fn create(
        pool: &SqlitePool,
        name: &str,
        email: Option<&str>,
        embedding: &[f32],
        sample_count: i64,
    ) -> Result<String, SqlxError> {
        let id = format!("profile-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let bytes = floats_to_bytes(embedding);

        sqlx::query(
            "INSERT INTO voice_profiles
             (id, name, email, embedding, embedding_dim, sample_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(email)
        .bind(&bytes)
        .bind(embedding.len() as i64)
        .bind(sample_count)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        Ok(id)
    }

    /// Update a profile's display fields (name + optional email). Replaces the
    /// previous narrow `rename` API — every UI surface for editing a profile
    /// shows both fields together, so the command does too.
    pub async fn update_profile(
        pool: &SqlitePool,
        id: &str,
        name: &str,
        email: Option<&str>,
    ) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let res = sqlx::query(
            "UPDATE voice_profiles SET name = ?, email = ?, updated_at = ? WHERE id = ?",
        )
        .bind(name)
        .bind(email)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<bool, SqlxError> {
        let res = sqlx::query("DELETE FROM voice_profiles WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        // Detach any transcript rows that referenced this profile so foreign
        // references don't dangle. We don't NULL out `speaker` because the
        // textual label may still be meaningful to the user.
        sqlx::query("UPDATE transcripts SET voice_profile_id = NULL WHERE voice_profile_id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    /// Replace a profile's centroid with a new one (used after the user merges
    /// additional samples or rebuilds from scratch). `sample_count` is the new
    /// total, not a delta.
    pub async fn update_centroid(
        pool: &SqlitePool,
        id: &str,
        embedding: &[f32],
        sample_count: i64,
    ) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let bytes = floats_to_bytes(embedding);
        let res = sqlx::query(
            "UPDATE voice_profiles
             SET embedding = ?, embedding_dim = ?, sample_count = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&bytes)
        .bind(embedding.len() as i64)
        .bind(sample_count)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }
}

/// Pack `f32` slice as little-endian bytes for BLOB storage. Total bytes = 4 * len.
pub fn floats_to_bytes(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

/// Inverse of [`floats_to_bytes`]. Returns `None` if `bytes.len()` is not a
/// multiple of 4 (corrupt blob).
pub fn bytes_to_floats(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        let arr: [u8; 4] = chunk.try_into().ok()?;
        out.push(f32::from_le_bytes(arr));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_floats_bytes() {
        let v = vec![1.0_f32, -2.5, 3.14159, 0.0, f32::INFINITY];
        let b = floats_to_bytes(&v);
        let r = bytes_to_floats(&b).unwrap();
        assert_eq!(r.len(), v.len());
        for (a, b) in v.iter().zip(&r) {
            assert!((a == b) || (a.is_nan() && b.is_nan()));
        }
    }

    #[test]
    fn corrupt_blob_returns_none() {
        let bytes = vec![0u8; 5]; // not a multiple of 4
        assert!(bytes_to_floats(&bytes).is_none());
    }
}
