"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Database as DatabaseIcon,
  FlaskConical,
  Mic,
  Plug,
  Settings2,
  SparkleIcon,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { TranscriptSettings } from "@/components/TranscriptSettings";
import { RecordingSettings } from "@/components/RecordingSettings";
import { PreferenceSettings } from "@/components/PreferenceSettings";
import { SummaryModelSettings } from "@/components/SummaryModelSettings";
import { BetaSettings } from "@/components/BetaSettings";
import { SpeakerSettings } from "@/components/SpeakerSettings";
import { CalendarSettings } from "@/components/CalendarSettings";
import { McpSettings } from "@/components/McpSettings";
import { useConfig } from "@/contexts/ConfigContext";
import { Button } from "@/components/ui/button";
import { Page, PageBody } from "@/components/layout/Page";

import { SettingsSidebar, type SettingsCategory } from "./parts/SettingsSidebar";
import { SettingsSection } from "./parts/SettingsSection";

const CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "general",
    label: "General",
    description: "Notifications, recording-folder location, and other defaults.",
    icon: Settings2,
  },
  {
    id: "recording",
    label: "Recordings",
    description: "Audio devices, capture format, and per-recording defaults.",
    icon: Mic,
  },
  {
    id: "speakers",
    label: "Speakers",
    description: "Saved voice profiles. Manage names, emails, and merges.",
    icon: Users,
  },
  {
    id: "transcription",
    label: "Transcription",
    description: "Whisper model selection and language preference.",
    icon: DatabaseIcon,
  },
  {
    id: "summary",
    label: "Summary",
    description: "AI engine + model that generates meeting summaries.",
    icon: SparkleIcon,
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Public ICS feeds. Link recordings to calendar events.",
    icon: CalendarDays,
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Connect an AI assistant to your meeting data via MCP.",
    icon: Plug,
  },
  {
    id: "beta",
    label: "Beta",
    description: "Experimental features still under active development.",
    icon: FlaskConical,
  },
] as const;

const DEFAULT_CATEGORY = CATEGORIES[0].id;

function isKnownCategory(id: string): boolean {
  return CATEGORIES.some((c) => c.id === id);
}

export default function SettingsPage() {
  const router = useRouter();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();

  const [activeId, setActiveId] = useState<string>(DEFAULT_CATEGORY);

  // Sync the active category with `location.hash` on mount so links like
  // `/settings#summary` deep-link to the right panel. We only push a new
  // hash on user-driven changes — replaceState (not pushState) so the
  // back button doesn't accumulate one history entry per category click.
  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, "");
    if (fromHash && isKnownCategory(fromHash)) {
      setActiveId(fromHash);
    }
  }, []);

  const handleSelect = (id: string) => {
    setActiveId(id);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  };

  // The ConfigContext already loads `transcriptModelConfig` on mount;
  // the legacy version of this page duplicated that fetch here, which
  // caused a brief content flash inside `<WhisperModelManager>` once
  // the second fetch resolved with the same data but a new object
  // reference (consumers re-rendered, the selected-model row briefly
  // unhighlighted). Trust the context — it owns this lifecycle.

  const active = CATEGORIES.find((c) => c.id === activeId) ?? CATEGORIES[0];

  return (
    <Page>
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="size-4" />
          <span>Back</span>
        </Button>
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <PageBody>
        <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
          <SettingsSidebar
            categories={CATEGORIES}
            activeId={activeId}
            onSelect={handleSelect}
          />
          <main className="min-w-0 flex-1">
            <SettingsSection
              title={active.label}
              description={active.description}
            >
              {active.id === "general" && <PreferenceSettings />}
              {active.id === "recording" && <RecordingSettings />}
              {active.id === "speakers" && <SpeakerSettings />}
              {active.id === "transcription" && (
                <TranscriptSettings
                  transcriptModelConfig={transcriptModelConfig}
                  setTranscriptModelConfig={setTranscriptModelConfig}
                />
              )}
              {active.id === "summary" && <SummaryModelSettings />}
              {active.id === "calendar" && <CalendarSettings />}
              {active.id === "integrations" && <McpSettings />}
              {active.id === "beta" && <BetaSettings />}
            </SettingsSection>
          </main>
        </div>
      </PageBody>
    </Page>
  );
}
