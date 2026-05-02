import React from "react";
import { AlertTriangle, Mic, Speaker, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { useIsLinux } from "@/hooks/usePlatform";

interface PermissionWarningProps {
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  onRecheck: () => void;
  isRechecking?: boolean;
}

export function PermissionWarning({
  hasMicrophone,
  hasSystemAudio,
  onRecheck,
  isRechecking = false,
}: PermissionWarningProps) {
  const isLinux = useIsLinux();

  // Don't show on Linux - permission handling is not needed
  if (isLinux) {
    return null;
  }

  // Don't show if both permissions are granted
  if (hasMicrophone && hasSystemAudio) {
    return null;
  }

  const isMacOS = navigator.userAgent.includes("Mac");

  const openMicrophoneSettings = async () => {
    if (isMacOS) {
      try {
        await invoke("open_system_settings", {
          preferencePane: "Privacy_Microphone",
        });
      } catch (error) {
        console.error("Failed to open microphone settings:", error);
      }
    }
  };

  const openScreenRecordingSettings = async () => {
    if (isMacOS) {
      try {
        await invoke("open_system_settings", {
          preferencePane: "Privacy_ScreenCapture",
        });
      } catch (error) {
        console.error("Failed to open screen recording settings:", error);
      }
    }
  };

  return (
    <div className="mb-4 max-w-md space-y-3">
      {/* Combined Permission Warning - Show when either permission is missing */}
      {(!hasMicrophone || !hasSystemAudio) && (
        <Alert variant="destructive" className="border-warning bg-warning-muted">
          <AlertTriangle className="size-5 text-warning" />
          <AlertTitle className="font-semibold text-warning-foreground">
            <div className="flex items-center gap-2">
              {!hasMicrophone && <Mic className="size-4" />}
              {!hasSystemAudio && <Speaker className="size-4" />}
              {!hasMicrophone && !hasSystemAudio
                ? "Permissions Required"
                : !hasMicrophone
                  ? "Microphone Permission Required"
                  : "System Audio Permission Required"}
            </div>
          </AlertTitle>
          {/* Action Buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            {isMacOS && !hasMicrophone && (
              <Button
                onClick={openMicrophoneSettings}
                className="bg-warning text-white hover:bg-warning/90"
              >
                <Mic className="size-4" />
                Open Microphone Settings
              </Button>
            )}
            {isMacOS && !hasSystemAudio && (
              <Button
                onClick={openScreenRecordingSettings}
                className="bg-info text-white hover:bg-info/90"
              >
                <Speaker className="size-4" />
                Open Screen Recording Settings
              </Button>
            )}
            <Button
              onClick={onRecheck}
              disabled={isRechecking}
              className="bg-warning-muted text-warning-foreground hover:bg-warning-muted/80"
            >
              <RefreshCw
                className={`
                  size-4
                  ${isRechecking ? "animate-spin" : ""}
                `}
              />
              Recheck
            </Button>
          </div>
          <AlertDescription className="mt-2 text-warning">
            {/* Microphone Warning */}
            {!hasMicrophone && (
              <>
                <p className="mb-3">
                  Meetily needs access to your microphone to record meetings. No
                  microphone devices were detected.
                </p>
                <div className="mb-4 space-y-2 text-sm">
                  <p className="font-medium">Please check:</p>
                  <ul className="ml-2 list-inside list-disc space-y-1">
                    <li>Your microphone is connected and powered on</li>
                    <li>Microphone permission is granted in System Settings</li>
                    <li>No other app is exclusively using the microphone</li>
                  </ul>
                </div>
              </>
            )}

            {/* System Audio Warning */}
            {!hasSystemAudio && (
              <>
                <p className="mb-3">
                  {hasMicrophone
                    ? "System audio capture is not available. You can still record with your microphone, but computer audio won't be captured."
                    : "System audio capture is also not available."}
                </p>
                {isMacOS && (
                  <div className="mb-4 space-y-2 text-sm">
                    <p className="font-medium">
                      To enable system audio on macOS:
                    </p>
                    <ul className="ml-2 list-inside list-disc space-y-1">
                      <li>
                        Install a virtual audio device (e.g., BlackHole 2ch)
                      </li>
                      <li>Grant Screen Recording permission to Meetily</li>
                      <li>Configure your audio routing in Audio MIDI Setup</li>
                    </ul>
                  </div>
                )}
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
