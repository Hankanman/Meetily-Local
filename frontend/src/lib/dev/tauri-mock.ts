/**
 * DEV-ONLY mock of `window.__TAURI_INTERNALS__`.
 *
 * Running `next dev` in a plain browser (no Tauri shell) leaves
 * `window.__TAURI_INTERNALS__` undefined, so the first `invoke()` / window-API
 * call — which the providers fire on mount — throws and blanks the page. This
 * shim installs a stand-in so the frontend renders and the UI/design can be
 * worked on without launching the full Tauri app.
 *
 * It is a no-op in three cases, so it can never affect the real app:
 *   1. Server-side (no `window`).
 *   2. Production builds (`process.env.NODE_ENV === "production"`).
 *   3. Inside a real Tauri runtime, where `__TAURI_INTERNALS__` is already set
 *      before any app JS runs — the guard below sees it and bails.
 *
 * The mock has no backend, so commands resolve to inert, correctly-shaped
 * defaults: lists come back empty, status flags come back "idle/false", and
 * events never fire. Interactive features (recording, model downloads, …) are
 * therefore no-ops here — this is strictly for rendering and layout work.
 */

// Commands whose resolved value a caller reads structurally (.map, destructure,
// nested access) on mount. Anything not listed falls back to `[]` (the list
// shape dominates and tolerates property access without throwing). A factory
// is used where the caller might mutate the result.
type Default = unknown | (() => unknown);

// --- Dev-only sample data ---------------------------------------------------
// Lets the sidebar and the home-screen meeting/task summaries render with
// realistic content when there's no backend. Never shipped: the whole mock is
// guarded off in production and inside the real Tauri runtime.
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();

const SAMPLE_MEETINGS = [
  { id: "m1", title: "Product review", updated_at: daysAgo(0) },
  { id: "m2", title: "Weekly sync", updated_at: daysAgo(1) },
  { id: "m3", title: "Roadmap planning", updated_at: daysAgo(3) },
  { id: "m4", title: "1:1 with Sam", updated_at: daysAgo(8) },
];

const sampleItem = (
  id: string,
  meetingId: string,
  text: string,
  assignee: string,
  dueHint: string,
) => ({
  id,
  meeting_id: meetingId,
  text,
  assignee,
  due_hint: dueHint,
  status: "open",
  source: "summary",
  external_ref: null,
  source_start_secs: null,
  source_end_secs: null,
  source_quote: null,
  created_at: daysAgo(0),
  updated_at: daysAgo(0),
  completed_at: null,
});

const SAMPLE_ACTION_ITEMS = [
  sampleItem("a1", "m1", "Draft customer training discovery videos", "Sarah D.", "Fri"),
  sampleItem("a2", "m1", "Circulate summary to the product channel", "You", "Today"),
  sampleItem("a3", "m2", "Follow up on Vulkan build regression", "You", "Mon"),
];

// All items (open + a couple of done) — backs the global Action Items page.
const SAMPLE_ALL_ACTION_ITEMS = [
  ...SAMPLE_ACTION_ITEMS,
  {
    ...sampleItem("a4", "m2", "Share the Q3 roadmap deck", "Josh", "Done last week"),
    status: "done",
    completed_at: daysAgo(2),
  },
  {
    ...sampleItem("a5", "m3", "Book the offsite venue", "Sam", ""),
    status: "done",
    completed_at: daysAgo(4),
    due_hint: null,
  },
];

const COMMAND_DEFAULTS: Record<string, Default> = {
  // --- Recording / transcription state (destructured — needs the object) ---
  get_recording_state: () => ({
    is_recording: false,
    is_paused: false,
    is_active: false,
    recording_duration: null,
    active_duration: null,
  }),
  is_recording: false,
  get_transcription_status: null,
  has_audio_checkpoints: false,

  // --- Onboarding gate ------------------------------------------------------
  // AppShell shows a full-screen OnboardingFlow (hiding the whole app) unless
  // this resolves to a non-null object with `completed: true`. That is the one
  // return value that lets the main UI render — do not weaken it.
  get_onboarding_status: () => ({
    version: "1.0",
    completed: true,
    current_step: 3,
    model_status: { parakeet: "downloaded", summary: "downloaded" },
    last_updated: "1970-01-01T00:00:00.000Z",
  }),
  check_first_launch: false, // DB "exists" → skips initialize_fresh_database
  // Enrolled self-voice profile → the "Mine" action-items scope resolves to
  // the seeded "You" items instead of an empty personal view.
  self_voice_status: () => ({
    enrolled: true,
    profile_id: "self-dev",
    name: "You",
    sample_count: 12,
    updated_at: "1970-01-01T00:00:00.000Z",
    model_ready: true,
  }),
  initialize_fresh_database: null,
  save_onboarding_status_cmd: null,
  whisper_has_available_models: true,
  builtin_ai_get_available_summary_model: null,
  builtin_ai_get_recommended_model: "gemma3:1b",

  // --- Audio devices / levels ----------------------------------------------
  get_audio_devices: () => [], // flat Device[] — consumers call .filter()
  start_audio_level_monitoring: null,
  stop_audio_level_monitoring: null,

  // --- Config / models ------------------------------------------------------
  api_get_transcript_config: null,
  api_get_ui_config: null,
  api_save_ui_config: null,
  set_language_preference: null,
  // Read unguarded in RecordingSettings (preferences.auto_save, .file_format …)
  // AND guarded in ConfigContext — so it must be the full object, not null.
  get_recording_preferences: () => ({
    save_folder: "/tmp/parley-dev/recordings",
    auto_save: true,
    file_format: "mp4",
    preferred_mic_device: null,
    preferred_system_device: null,
    show_recording_notification: true,
  }),
  api_get_model_config: null,
  api_get_api_key: null,
  api_get_custom_openai_config: null,
  // Guarded by `if (settings)`, then read nested as
  // `.notification_preferences.show_recording_started` — null skips it safely.
  get_notification_settings: null,
  get_ollama_models: () => [], // .map()
  whisper_get_available_models: () => [], // .some()
  builtin_ai_list_models: () => [],

  // --- Filesystem paths (shown as strings in Settings) ---------------------
  get_database_directory: "/tmp/parley-dev",
  whisper_get_models_directory: "/tmp/parley-dev/models",
  get_default_recordings_folder_path: "/tmp/parley-dev/recordings",

  // --- Meetings / lists (.map()/.length) -----------------------------------
  // Seeded with sample data (dev-only) so the sidebar + home-screen meeting and
  // task summaries render with content instead of empty states.
  api_get_meetings: () => SAMPLE_MEETINGS,
  get_transcript_history: () => [],
  list_action_items: () => SAMPLE_ALL_ACTION_ITEMS,
  list_open_action_items: () => SAMPLE_ACTION_ITEMS,
  list_meeting_notes: () => [],
  list_voice_profiles: () => [],

  // --- Meeting details (empty meeting → page shows its spinner guard) -------
  // metadata: null makes the derived `meeting` null, so page.tsx renders its
  // loading spinner rather than building a broken meeting object.
  api_get_meeting_metadata: null,
  api_get_meeting_transcripts: () => ({
    transcripts: [],
    total_count: 0,
    has_more: false,
  }),
  // Read as `summary.status` / `summary.data` — "idle" means "no summary yet".
  api_get_summary: () => ({ status: "idle", data: null }),
};

// --- Callback registry (transformCallback / Channel) ------------------------
let nextCallbackId = 0;
const callbacks = new Map<number, (payload: unknown) => void>();

// Track which unmapped commands we've already warned about, so the console
// gets one line per command rather than one per call.
const warned = new Set<string>();

// For commands with no explicit default, guess a non-crashing shape from the
// name: single objects are usually read behind an `if (x)` guard (so `null` is
// safe and `[]` — truthy — would let nested access throw); paths are strings;
// everything else is treated as a list. Explicit COMMAND_DEFAULTS always win.
function fallbackFor(cmd: string): unknown {
  if (/(directory|folder|_path|_dir)$/.test(cmd)) return "/tmp/parley-dev";
  if (/(_config|_settings|_status|_state|_preferences|_info)$/.test(cmd)) {
    return null;
  }
  return [];
}

function resolveCommand(cmd: string): unknown {
  if (cmd in COMMAND_DEFAULTS) {
    const d = COMMAND_DEFAULTS[cmd];
    return typeof d === "function" ? (d as () => unknown)() : d;
  }
  const fallback = fallbackFor(cmd);
  if (!warned.has(cmd)) {
    warned.add(cmd);
    console.debug(`[tauri-mock] unhandled command "${cmd}" →`, fallback);
  }
  return fallback;
}

function resolvePlugin(cmd: string): unknown {
  // Shape: "plugin:<name>|<method>"
  const [, rest = ""] = cmd.split(":");
  const [name, method = ""] = rest.split("|");

  switch (name) {
    case "event":
      // listen → an event id (number); everything else is fire-and-forget.
      return method === "listen" ? ++nextCallbackId : undefined;
    case "window":
    case "webview":
    case "webviewWindow":
      if (/^(is_|internal_is_)/.test(method)) return false; // is_maximized, is_fullscreen, …
      if (method === "theme") return "dark";
      if (method === "scale_factor") return 1;
      return undefined;
    case "path":
      // appDataDir / downloadDir / resolve / join — return a stable fake path
      // so `${dir}/file` string building doesn't produce "undefined/…".
      return "/tmp/parley-dev";
    case "os":
      if (method === "platform") return "linux";
      if (method === "version") return "0.0.0";
      return "linux";
    case "app":
      if (method === "version") return "0.4.0-dev";
      if (method === "name") return "Parley";
      if (method === "tauri_version") return "2.11.0";
      return undefined;
    default:
      return undefined;
  }
}

export function installTauriMock(): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "production") return;
  // Real Tauri runtime (or an already-installed mock) — leave it alone.
  if ("__TAURI_INTERNALS__" in window) return;

  const internals = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    async invoke(cmd: string, _args?: unknown, _options?: unknown) {
      void _args;
      void _options;
      return cmd.startsWith("plugin:")
        ? resolvePlugin(cmd)
        : resolveCommand(cmd);
    },
    transformCallback(callback: (payload: unknown) => void, _once = false) {
      void _once;
      const id = ++nextCallbackId;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    convertFileSrc(filePath: string, _protocol?: string) {
      void _protocol;
      return filePath;
    },
  };

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: internals,
    configurable: true,
    writable: true,
  });

  // Tauri v2's event `_unlisten` reads this SECOND global directly (it does not
  // route through `invoke`), so an unlisten cleanup — fired on every unmount /
  // route change — throws "unregisterListener of undefined" without it.
  Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
    value: {
      unregisterListener(_event: string, id: number) {
        void _event;
        callbacks.delete(id);
      },
    },
    configurable: true,
    writable: true,
  });

  console.info(
    "[tauri-mock] installed — running without a Tauri backend (dev only). " +
      "Native features are inert; this is for UI/design work.",
  );
}

// Run on import so the mock is installed the moment this module evaluates —
// before any provider module (imported after it) runs its own top-level or
// mount-time Tauri calls. Guarded internally, so it's a no-op server-side, in
// production, and inside a real Tauri runtime.
installTauriMock();
