import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Info } from "lucide-react";

export interface BackendInfo {
  id: string;
  name: string;
  description: string;
}

interface AudioBackendSelectorProps {
  currentBackend?: string;
  onBackendChange?: (backend: string) => void;
  disabled?: boolean;
}

export function AudioBackendSelector({
  currentBackend: propBackend,
  onBackendChange,
  disabled = false,
}: AudioBackendSelectorProps) {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [currentBackend, setCurrentBackend] = useState<string>("coreaudio");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  // Load available backends and current selection
  useEffect(() => {
    const loadBackends = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get backend info (includes name and description)
        const backendInfo = await invoke<BackendInfo[]>(
          "get_audio_backend_info",
        );
        setBackends(backendInfo);

        // Get current backend if not provided via props
        if (!propBackend) {
          const current = await invoke<string>("get_current_audio_backend");
          setCurrentBackend(current);
        } else {
          setCurrentBackend(propBackend);
        }
      } catch (err) {
        console.error("Failed to load audio backends:", err);
        setError("Failed to load backend options");
      } finally {
        setLoading(false);
      }
    };

    loadBackends();
  }, [propBackend]);

  // Handle backend selection
  const handleBackendChange = async (backendId: string) => {
    try {
      setError(null);
      await invoke("set_audio_backend", { backend: backendId });
      setCurrentBackend(backendId);

      // Notify parent component
      if (onBackendChange) {
        onBackendChange(backendId);
      }

      console.log(`Audio backend changed to: ${backendId}`);
    } catch (err) {
      console.error("Failed to set audio backend:", err);
      setError("Failed to change backend. Please try again.");
    }
  };

  // Only show selector if there are multiple backends
  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="mb-2 h-4 w-32 rounded-sm bg-muted"></div>
        <div className="h-10 rounded-sm bg-muted"></div>
      </div>
    );
  }

  // Hide if only one backend available
  if (backends.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-foreground">
          System Audio Backend
        </label>
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className="
              text-muted-foreground/70 transition-colors
              hover:text-muted-foreground
            "
          >
            <Info className="size-4" />
          </button>
          {showTooltip && (
            <div className="
              absolute top-0 left-6 z-10 w-64 rounded-lg bg-gray-900 p-3 text-xs
              text-white shadow-lg
            ">
              <p className="mb-1 font-semibold">Audio Capture Methods:</p>
              <ul className="space-y-1">
                {backends.map((backend) => (
                  <li key={backend.id}>
                    <span className="font-medium">{backend.name}:</span>{" "}
                    {backend.description}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground/70">
                Try different backends to find which works best for your system.
              </p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="
          rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700
        ">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {backends.map((backend) => {
          // Disable Core Audio option
          const isCoreAudio = backend.id === "screencapturekit";
          const isDisabled = disabled || isCoreAudio;

          return (
            <label
              key={backend.id}
              className={`
                flex items-start rounded-lg border p-3 transition-all
                ${
                currentBackend === backend.id
                  ? "border-blue-500 bg-blue-600/10"
                  : `
                    border-border bg-background
                    hover:border-border
                  `
              }
                ${isDisabled ? "cursor-not-allowed opacity-50" : `
                  cursor-pointer
                `}
              `}
            >
              <input
                type="radio"
                name="audioBackend"
                value={backend.id}
                checked={currentBackend === backend.id}
                onChange={() => handleBackendChange(backend.id)}
                disabled={isDisabled}
                className="
                  mt-1 size-4 border-border text-blue-600
                  focus:ring-blue-500
                "
              />
              <div className="ml-3 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {backend.name}
                  </span>
                  {currentBackend === backend.id && (
                    <span className="
                      rounded-sm bg-blue-600/15 px-2 py-0.5 text-xs font-medium
                      text-blue-600
                    ">
                      Active
                    </span>
                  )}
                  {isCoreAudio && (
                    <span className="
                      rounded-sm bg-muted px-2 py-0.5 text-xs font-medium
                      text-muted-foreground
                    ">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {backend.description}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>• Backend selection only affects system audio capture</p>
        <p>• Microphone always uses the default method</p>
        <p>• Changes apply to new recording sessions</p>
      </div>
    </div>
  );
}
