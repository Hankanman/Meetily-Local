//! Application directories, resolved without a Tauri `AppHandle`.
//!
//! Tauri's `app_data_dir()` on Linux is `dirs::data_dir()/<identifier>`
//! (`~/.local/share/com.meetily.ai`); this resolves the same path directly so
//! core code — and a non-Tauri shell — can reach the database, models and
//! recordings without the Tauri path resolver. The identifier must stay
//! `com.meetily.ai`: existing user data lives there and `meetily-mcp`
//! (`meetily_mcp::cli::APP_IDENTIFIER`) resolves the database the same way.

use std::path::PathBuf;

/// Bundle identifier; also the data-directory name. See module docs.
pub const APP_IDENTIFIER: &str = "com.meetily.ai";

/// Per-user application data directory (`~/.local/share/com.meetily.ai`).
///
/// Errors only if the platform has no data directory at all (no `$HOME`),
/// which Tauri's resolver would also fail on.
pub fn app_data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .map(|dir| dir.join(APP_IDENTIFIER))
        .ok_or_else(|| "Could not resolve the user data directory".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_dir_ends_with_identifier() {
        let dir = app_data_dir().expect("data dir");
        assert!(dir.ends_with(APP_IDENTIFIER));
    }
}
