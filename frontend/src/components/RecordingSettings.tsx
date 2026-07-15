import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { DeviceSelection, SelectedDevices } from "@/components/DeviceSelection";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import {
  SettingsCard,
  SettingsRow,
} from "@/app/settings/parts/SettingsCard";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  show_recording_notification: boolean;
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: "",
    auto_save: true,
    file_format: "mp4",
    preferred_mic_device: null,
    preferred_system_device: null,
    show_recording_notification: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load recording preferences (including the notification toggle) on
  // component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>(
          "get_recording_preferences",
        );
        setPreferences(prefs);
      } catch (error) {
        console.error("Failed to load recording preferences:", error);
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>(
            "get_default_recordings_folder_path",
          );
          setPreferences((prev) => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error("Failed to get default folder path:", defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, auto_save: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice,
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
  };

  const handleOpenFolder = async () => {
    try {
      await invoke("open_recordings_folder");
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
      toast.error("Couldn't open the recordings folder.");
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    const newPreferences = {
      ...preferences,
      show_recording_notification: enabled,
    };
    setPreferences(newPreferences);
    try {
      await invoke("set_recording_preferences", {
        preferences: newPreferences,
      });
      toast.success("Preference saved");
    } catch (error) {
      console.error("Failed to save notification preference:", error);
      toast.error("Failed to save preference");
    }
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    setSaving(true);
    try {
      await invoke("set_recording_preferences", { preferences: prefs });
      onSave?.(prefs);

      // Show success toast with device details
      const micDevice = prefs.preferred_mic_device || "Default";
      const systemDevice = prefs.preferred_system_device || "Default";
      toast.success("Device preferences saved", {
        description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`,
      });
    } catch (error) {
      console.error("Failed to save recording preferences:", error);
      toast.error("Failed to save device preferences", {
        description: getErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <SettingsCard>
          <div className="h-12 animate-pulse rounded-md bg-muted/40" />
        </SettingsCard>
        <SettingsCard>
          <div className="h-20 animate-pulse rounded-md bg-muted/40" />
        </SettingsCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsCard>
        <SettingsRow
          label="Save audio recordings"
          description="Automatically save audio files when recording stops"
        >
          <Switch
            checked={preferences.auto_save}
            onCheckedChange={handleAutoSaveToggle}
            disabled={saving}
          />
        </SettingsRow>
      </SettingsCard>

      {preferences.auto_save && (
        <>
          <SettingsCard
            title="Save location"
            description="Where the audio file for each meeting is written."
          >
            <div className="space-y-3">
              <p className="text-sm break-all text-muted-foreground">
                {preferences.save_folder || "Default folder"}
              </p>
              <Button variant="outline" size="sm" onClick={handleOpenFolder}>
                <FolderOpen className="size-4" />
                Open folder
              </Button>
            </div>
          </SettingsCard>

          <SettingsCard
            title="File format"
            description={`Recordings are saved as recording_YYYYMMDD_HHMMSS.${preferences.file_format}.`}
          >
            <p className="text-sm font-medium text-foreground">
              {preferences.file_format.toUpperCase()}
            </p>
          </SettingsCard>
        </>
      )}

      {!preferences.auto_save && (
        <Alert variant="warning">
          <AlertDescription>
            Audio recording is disabled. Enable &quot;Save audio
            recordings&quot; to automatically save meeting audio.
          </AlertDescription>
        </Alert>
      )}

      <SettingsCard>
        <SettingsRow
          label="Recording-start notification"
          description="Show a reminder so participants are informed when recording begins"
        >
          <Switch
            checked={preferences.show_recording_notification}
            onCheckedChange={handleNotificationToggle}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        title="Default audio devices"
        description="The microphone and system audio source automatically selected when you start a new recording."
      >
        <DeviceSelection
          selectedDevices={{
            micDevice: preferences.preferred_mic_device,
            systemDevice: preferences.preferred_system_device,
          }}
          onDeviceChange={handleDeviceChange}
          disabled={saving}
        />
      </SettingsCard>
    </div>
  );
}
