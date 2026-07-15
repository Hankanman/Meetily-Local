"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Globe, Mic, Speaker } from "lucide-react";
import { useConfig } from "@/contexts/ConfigContext";
import type {
  AudioDevice,
  SelectedDevices,
} from "@/components/DeviceSelection";
import { DeviceChip } from "./DeviceChip";

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto detect" },
  { value: "auto-translate", label: "Auto detect + translate to English" },
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "ru", label: "Russian" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "tr", label: "Turkish" },
  { value: "pl", label: "Polish" },
  { value: "sv", label: "Swedish" },
  { value: "da", label: "Danish" },
  { value: "no", label: "Norwegian" },
  { value: "fi", label: "Finnish" },
];

interface DeviceSummaryProps {
  /** Disable selection (e.g. during the "starting recording" flash). */
  disabled?: boolean;
}

/**
 * Three pill chips on the pre-recording hero: microphone, system audio,
 * language. Each opens a popover for changing the value. The state lives
 * in `useConfig()` (`selectedDevices` and `selectedLanguage`); we just
 * read + drive it.
 */
export function DeviceSummary({ disabled = false }: DeviceSummaryProps) {
  const {
    selectedDevices,
    setSelectedDevices,
    selectedLanguage,
    setSelectedLanguage,
  } = useConfig();
  const [devices, setDevices] = useState<AudioDevice[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<AudioDevice[]>("get_audio_devices");
        if (!cancelled) setDevices(list);
      } catch (err) {
        console.error("Failed to fetch audio devices:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const inputs = devices.filter((d) => d.kind === "microphone");
  const outputs = devices.filter((d) => d.kind === "system");

  // "default" is the canonical sentinel — same value DeviceSelection
  // uses on the Settings page. Storing `null` in the context means
  // "use the system default device" (the backend treats null this way).
  const setMic = (id: string) =>
    setSelectedDevices({
      ...selectedDevices,
      micDevice: id === "default" ? null : id,
    } as SelectedDevices);
  const setSystem = (id: string) =>
    setSelectedDevices({
      ...selectedDevices,
      systemDevice: id === "default" ? null : id,
    } as SelectedDevices);

  // Selections are stored as PipeWire node ids; show the human label.
  const labelFor = (id: string | null | undefined, fallback: string) =>
    id ? (devices.find((d) => d.id === id)?.label ?? id) : fallback;
  const micLabel = labelFor(selectedDevices?.micDevice, "Default microphone");
  const systemLabel = labelFor(
    selectedDevices?.systemDevice,
    "Default system audio",
  );
  const languageLabel =
    LANGUAGE_OPTIONS.find((l) => l.value === selectedLanguage)?.label ??
    "Auto detect";

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <DeviceChip
        icon={<Mic className="size-3.5" />}
        value={micLabel}
        options={[
          { value: "default", label: "Default microphone" },
          ...inputs.map((d) => ({ value: d.id, label: d.label })),
        ]}
        selectedValue={selectedDevices?.micDevice ?? "default"}
        onSelect={setMic}
        emptyState="No microphones detected"
        disabled={disabled}
      />
      <DeviceChip
        icon={<Speaker className="size-3.5" />}
        value={systemLabel}
        options={[
          { value: "default", label: "Default system audio" },
          ...outputs.map((d) => ({ value: d.id, label: d.label })),
        ]}
        selectedValue={selectedDevices?.systemDevice ?? "default"}
        onSelect={setSystem}
        emptyState="No output devices detected"
        disabled={disabled}
      />
      <DeviceChip
        icon={<Globe className="size-3.5" />}
        value={languageLabel}
        options={LANGUAGE_OPTIONS}
        selectedValue={selectedLanguage}
        onSelect={setSelectedLanguage}
        disabled={disabled}
      />
    </div>
  );
}
