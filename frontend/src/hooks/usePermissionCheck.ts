import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getErrorMessage } from "@/lib/utils";

interface PermissionStatus {
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  isChecking: boolean;
  error: string | null;
}

export function usePermissionCheck() {
  const [status, setStatus] = useState<PermissionStatus>({
    hasMicrophone: false,
    hasSystemAudio: false,
    isChecking: true,
    error: null,
  });

  const checkPermissions = useCallback(async () => {
    setStatus((prev) => ({ ...prev, isChecking: true, error: null }));

    try {
      // Get audio devices to check for microphone and system audio availability
      const devices = await invoke<
        Array<{ id: string; label: string; kind: "microphone" | "system" }>
      >("get_audio_devices");

      const inputDevices = devices.filter((d) => d.kind === "microphone");
      const hasMicrophone = inputDevices.length > 0;

      const outputDevices = devices.filter((d) => d.kind === "system");
      const hasSystemAudio = outputDevices.length > 0;

      console.log("Permission check:", {
        hasMicrophone,
        hasSystemAudio,
        inputDevices: inputDevices.length,
        outputDevices: outputDevices.length,
      });

      setStatus({
        hasMicrophone,
        hasSystemAudio,
        isChecking: false,
        error: null,
      });

      return { hasMicrophone, hasSystemAudio };
    } catch (error) {
      console.error("Failed to check audio permissions:", error);
      setStatus({
        hasMicrophone: false,
        hasSystemAudio: false,
        isChecking: false,
        error: getErrorMessage(error, "Failed to check permissions"),
      });
      return { hasMicrophone: false, hasSystemAudio: false };
    }
  }, []);

  const requestPermissions = async () => {
    try {
      // Trigger audio permission by trying to access devices
      await invoke("get_audio_devices");

      // Recheck after triggering
      setTimeout(() => {
        checkPermissions();
      }, 1000);
    } catch (error) {
      console.error("Failed to request permissions:", error);
    }
  };

  // Check permissions on mount. setStatus happens after await inside checkPermissions.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkPermissions();
  }, [checkPermissions]);

  return {
    ...status,
    checkPermissions,
    requestPermissions,
  };
}
