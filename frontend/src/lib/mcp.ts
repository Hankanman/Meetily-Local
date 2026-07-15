// Frontend wrappers for the MCP-server config commands (Settings →
// Integrations). The Rust side (`mcp_config.rs`) serializes with camelCase
// field names via `#[serde(rename = ...)]`, so these shapes match directly.

import { invoke } from "@tauri-apps/api/core";

export interface McpServerInfo {
  /** Absolute path to the SQLite database the app uses. */
  dbPath: string;
  /** Whether that file exists yet (created on the app's first run). */
  dbExists: boolean;
  /** True when `dbPath` is the platform-default the server picks with no flag,
   *  meaning the registration snippet can omit `--db` entirely. */
  dbIsDefault: boolean;
  /** Best-effort absolute path to the `meetily-mcp` binary, or null if not
   *  found. Treated as a prefill the user can override. */
  binaryPath: string | null;
  /** Whether `binaryPath` was located and points at a real file. */
  binaryFound: boolean;
}

export async function getMcpServerInfo(): Promise<McpServerInfo> {
  return invoke<McpServerInfo>("get_mcp_server_info");
}

export async function revealMcpBinary(path: string): Promise<void> {
  return invoke("reveal_mcp_binary", { path });
}
