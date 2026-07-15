"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/app/settings/parts/SettingsCard";
import {
  getMcpServerInfo,
  revealMcpBinary,
  type McpServerInfo,
} from "@/lib/mcp";

/** localStorage key for a user-supplied binary path override. Only affects the
 *  snippet this panel renders — the app never spawns the binary itself. */
const BINARY_OVERRIDE_KEY = "meetily.mcpBinaryPath";

/** Placeholder shown in snippets when we have no real path to offer. */
const BINARY_PLACEHOLDER = "/absolute/path/to/meetily-mcp";

type ClientId = "claude-code" | "claude-desktop" | "json";

const CLIENTS: readonly { id: ClientId; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "json", label: "Generic JSON" },
] as const;

/** Build the registration snippet for a given client. `db` is included only
 *  when it isn't the default the server would resolve on its own. */
function buildSnippet(
  client: ClientId,
  binary: string,
  db: string | null,
): string {
  const bin = binary || BINARY_PLACEHOLDER;
  if (client === "claude-code") {
    const dbArg = db ? ` --db ${db}` : "";
    return `claude mcp add meetily -- ${bin}${dbArg}`;
  }
  // Both Claude Desktop and the generic form are the same JSON block.
  const server: Record<string, unknown> = { command: bin };
  if (db) server.args = ["--db", db];
  return JSON.stringify({ mcpServers: { meetily: server } }, null, 2);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      toast.error(`Couldn't copy: ${e}`);
    }
  }, [text, label]);

  return (
    <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function McpSettings() {
  const [info, setInfo] = useState<McpServerInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [client, setClient] = useState<ClientId>("claude-code");
  const [override, setOverride] = useState<string>("");

  const reload = useCallback(async () => {
    try {
      setInfo(await getMcpServerInfo());
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    try {
      setOverride(localStorage.getItem(BINARY_OVERRIDE_KEY) ?? "");
    } catch {
      // localStorage may be unavailable; the detected path still works.
    }
  }, [reload]);

  const saveOverride = useCallback((value: string) => {
    setOverride(value);
    try {
      if (value.trim()) localStorage.setItem(BINARY_OVERRIDE_KEY, value.trim());
      else localStorage.removeItem(BINARY_OVERRIDE_KEY);
    } catch {
      // Non-fatal — the snippet still reflects the typed value this session.
    }
  }, []);

  // The override wins over the detected path so a user who built the binary
  // somewhere we didn't look can still get a correct snippet.
  const effectiveBinary = override.trim() || info?.binaryPath || "";
  const dbArg = info && !info.dbIsDefault ? info.dbPath : null;

  const snippet = useMemo(
    () => buildSnippet(client, effectiveBinary, dbArg),
    [client, effectiveBinary, dbArg],
  );

  const binaryMissing = !effectiveBinary;

  return (
    <div className="space-y-6">
      <SettingsCard
        title="MCP server"
        description="Expose your meetings, transcripts, summaries, and action items to an AI assistant like Claude Code or Claude Desktop. The assistant reads (and, if you allow it, writes) your meeting data through a local process — nothing leaves your machine except to the assistant you connect."
      >
        {loadError && (
          <p className="mb-3 text-sm text-destructive">{loadError}</p>
        )}

        {/* Binary path */}
        <div className="space-y-1.5">
          <label
            htmlFor="mcp-binary-path"
            className="text-sm font-medium text-foreground"
          >
            Server binary
          </label>
          <div className="flex items-center gap-2">
            <input
              id="mcp-binary-path"
              type="text"
              value={override || info?.binaryPath || ""}
              onChange={(e) => saveOverride(e.target.value)}
              placeholder={BINARY_PLACEHOLDER}
              spellCheck={false}
              className="
                h-9 w-full rounded-md border border-border bg-background px-3
                font-mono text-xs placeholder:text-muted-foreground/70
                focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none
              "
            />
            {effectiveBinary && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  revealMcpBinary(effectiveBinary).catch((e) =>
                    toast.error(`Couldn't open folder: ${e}`),
                  )
                }
                className="shrink-0 gap-1.5"
                title="Show in file manager"
              >
                <FolderOpen className="size-3.5" />
              </Button>
            )}
          </div>
          {info?.binaryFound && !override.trim() ? (
            <p className="flex items-center gap-1.5 text-xs text-success">
              <Check className="size-3.5" /> Found automatically.
            </p>
          ) : binaryMissing ? (
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>
                Binary not found. Build it with{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  ./build.sh
                </code>{" "}
                (or{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  cargo build --release -p meetily-mcp
                </code>
                ), then paste its absolute path above.
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Using the path you entered.
            </p>
          )}
        </div>

        {/* Database path */}
        <div className="mt-4 space-y-1.5">
          <span className="text-sm font-medium text-foreground">Database</span>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {info?.dbPath ?? "…"}
          </p>
          <p className="text-xs text-muted-foreground">
            {info == null
              ? ""
              : !info.dbExists
                ? "Not created yet — record a meeting first so the app creates it."
                : info.dbIsDefault
                  ? "This is the default location, so the snippet omits an explicit path."
                  : "A custom location, so the snippet points the server at it."}
          </p>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Register with a client"
        description="The client spawns the binary and talks to it over stdin/stdout — you never run it by hand. Paste the snippet into your client's config."
      >
        {/* Client tabs */}
        <div className="mb-3 flex gap-1">
          {CLIENTS.map((c) => (
            <button
              key={c.id}
              onClick={() => setClient(c.id)}
              className={`
                rounded-md px-3 py-1.5 text-sm transition-colors
                ${
                  client === c.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }
              `}
            >
              {c.label}
            </button>
          ))}
        </div>

        {client === "claude-desktop" && (
          <p className="mb-2 text-xs text-muted-foreground">
            Edit{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              ~/.config/Claude/claude_desktop_config.json
            </code>{" "}
            and restart Claude Desktop.
          </p>
        )}

        <div className="relative">
          <pre
            className="
              overflow-x-auto rounded-md border border-border bg-muted/50 p-3
              pr-20 font-mono text-xs leading-relaxed text-foreground
            "
          >
            {snippet}
          </pre>
          <div className="absolute right-2 top-2">
            <CopyButton text={snippet} label="Snippet" />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void reload()}
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            Re-detect
          </Button>
          <span className="text-xs text-muted-foreground">
            Then ask your assistant things like &quot;what action items do I
            still have open?&quot;
          </span>
        </div>
      </SettingsCard>
    </div>
  );
}
