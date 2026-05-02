import React from "react";
import { AlertTriangle, Mic, Speaker, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
        <Alert variant="destructive" className="border-amber-400 bg-amber-50">
          <AlertTriangle className="size-5 text-amber-600" />
          <AlertTitle className="font-semibold text-amber-900">
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
              <button
                onClick={openMicrophoneSettings}
                className="
                  inline-flex items-center gap-2 rounded-md bg-amber-600 px-4
                  py-2 text-sm font-medium text-white transition-colors
                  hover:bg-amber-700
                "
              >
                <Mic className="size-4" />
                Open Microphone Settings
              </button>
            )}
            {isMacOS && !hasSystemAudio && (
              <button
                onClick={openScreenRecordingSettings}
                className="
                  inline-flex items-center gap-2 rounded-md bg-blue-600 px-4
                  py-2 text-sm font-medium text-white transition-colors
                  hover:bg-blue-700
                "
              >
                <Speaker className="size-4" />
                Open Screen Recording Settings
              </button>
            )}
            <button
              onClick={onRecheck}
              disabled={isRechecking}
              className="
                inline-flex items-center gap-2 rounded-md bg-amber-100 px-4 py-2
                text-sm font-medium text-amber-900 transition-colors
                hover:bg-amber-200
                disabled:opacity-50
              "
            >
              <RefreshCw
                className={`
                  size-4
                  ${isRechecking ? "animate-spin" : ""}
                `}
              />
              Recheck
            </button>
          </div>
          <AlertDescription className="mt-2 text-amber-800">
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
