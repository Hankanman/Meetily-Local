import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Mic, Speaker } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * A capture device as reported by the PipeWire registry.
 * `id` is the stable node name (used for selection/preferences),
 * `label` the human-readable description shown in pickers.
 */
export interface AudioDevice {
  id: string;
  label: string;
  kind: "microphone" | "system";
}

export interface SelectedDevices {
  /** PipeWire node id, or null = system default. */
  micDevice: string | null;
  systemDevice: string | null;
}

interface DeviceSelectionProps {
  selectedDevices: SelectedDevices;
  onDeviceChange: (devices: SelectedDevices) => void;
  disabled?: boolean;
}

export function DeviceSelection({
  selectedDevices,
  onDeviceChange,
  disabled = false,
}: DeviceSelectionProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const microphones = devices.filter((d) => d.kind === "microphone");
  const systemDevices = devices.filter((d) => d.kind === "system");

  // Fetch available audio devices
  const fetchDevices = useCallback(async () => {
    try {
      setError(null);
      const result = await invoke<AudioDevice[]>("get_audio_devices");
      setDevices(result);
      console.log("Fetched audio devices:", result);
    } catch (err) {
      console.error("Failed to fetch audio devices:", err);
      setError(
        "Failed to load audio devices. Please check your system audio settings.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load devices on component mount
  useEffect(() => {
    // setState happens after await; the rule cannot see through async boundaries.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDevices();
  }, [fetchDevices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDevices();
  };

  const handleMicDeviceChange = (deviceId: string) => {
    onDeviceChange({
      ...selectedDevices,
      micDevice: deviceId === "default" ? null : deviceId,
    });
  };

  const handleSystemDeviceChange = (deviceId: string) => {
    onDeviceChange({
      ...selectedDevices,
      systemDevice: deviceId === "default" ? null : deviceId,
    });
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <div className="animate-pulse">
          <div className="mb-4 h-4 w-1/3 rounded-md bg-muted"></div>
          <div className="mb-3 h-10 rounded-md bg-muted"></div>
          <div className="h-10 rounded-md bg-muted"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">Audio Devices</h4>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={refreshing || disabled}
          className="size-8"
        >
          <RefreshCw
            className={`
              size-4
              ${refreshing ? "animate-spin" : ""}
            `}
          />
        </Button>
      </div>

      {error && (
        <div
          className="
          rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive
        "
        >
          {error}
        </div>
      )}

      <div className="space-y-3">
        {/* Microphone Selection */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Mic className="size-4 text-muted-foreground" />
            <Label
              htmlFor="mic-selection"
              className="text-sm font-medium text-foreground"
            >
              Microphone
            </Label>
          </div>
          <Select
            value={selectedDevices.micDevice || "default"}
            onValueChange={handleMicDeviceChange}
            disabled={disabled}
          >
            <SelectTrigger id="mic-selection" className="w-full">
              <SelectValue placeholder="Select Microphone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default Microphone</SelectItem>
              {microphones.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {microphones.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No microphone devices found
            </p>
          )}
        </div>

        {/* System Audio Selection */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Speaker className="size-4 text-muted-foreground" />
            <Label
              htmlFor="system-selection"
              className="text-sm font-medium text-foreground"
            >
              System Audio
            </Label>
          </div>

          <Select
            value={selectedDevices.systemDevice || "default"}
            onValueChange={handleSystemDeviceChange}
            disabled={disabled}
          >
            <SelectTrigger id="system-selection" className="w-full">
              <SelectValue placeholder="Select System Audio" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default System Audio</SelectItem>
              {systemDevices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {systemDevices.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No system audio devices found
            </p>
          )}
        </div>
      </div>

      {/* Info text */}
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          • <strong>Microphone:</strong> Records your voice and ambient sound
        </p>
        <p>
          • <strong>System Audio:</strong> Records computer audio (music, calls,
          etc.) from the selected output device
        </p>
      </div>
    </div>
  );
}
