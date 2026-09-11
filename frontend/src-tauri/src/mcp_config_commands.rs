//! Tauri command wrappers for the `meetily-mcp` Integrations panel. Core
//! logic (binary discovery, DB path resolution) lives in `mcp_config`.

use crate::mcp_config::{self, McpServerInfo};

/// Report the DB path plus a best-effort location for the `meetily-mcp`
/// binary so the Integrations settings panel can render client-registration
/// config.
#[tauri::command]
pub async fn get_mcp_server_info() -> Result<McpServerInfo, String> {
    mcp_config::get_mcp_server_info()
}

/// Open the folder containing the `meetily-mcp` binary in the system file
/// manager, so the user can grab its path or confirm it's there.
#[tauri::command]
pub async fn reveal_mcp_binary(path: String) -> Result<(), String> {
    mcp_config::reveal_mcp_binary(path)
}
