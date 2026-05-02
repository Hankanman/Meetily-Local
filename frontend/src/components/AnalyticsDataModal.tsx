"use client";

import React from "react";
import { X, Info, Shield } from "lucide-react";

interface AnalyticsDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDisable: () => void;
}

export default function AnalyticsDataModal({
  isOpen,
  onClose,
  onConfirmDisable,
}: AnalyticsDataModalProps) {
  if (!isOpen) return null;

  return (
    <div className="
      fixed inset-0 z-50 flex items-center justify-center
      bg-foreground/50
    ">
      <div className="
        mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg
        bg-background shadow-xl
      ">
        {/* Header */}
        <div className="
          flex items-center justify-between border-b border-border p-6
        ">
          <div className="flex items-center gap-3">
            <Shield className="size-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-foreground">
              What We Collect
            </h2>
          </div>
          <button
            onClick={onClose}
            className="
              text-muted-foreground/70 transition-colors
              hover:text-muted-foreground
            "
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6 p-6">
          {/* Privacy Notice */}
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 size-5 shrink-0 text-green-600" />
              <div className="text-sm text-green-800">
                <p className="mb-1 font-semibold">Your Privacy is Protected</p>
                <p>
                  We collect <strong>anonymous usage data only</strong>. No
                  meeting content, names, or personal information is ever
                  collected.
                </p>
              </div>
            </div>
          </div>

          {/* Data Categories */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Data We Collect:
            </h3>

            {/* Model Preferences */}
            <div className="rounded-lg border border-border p-4">
              <h4 className="mb-2 font-semibold text-foreground">
                1. Model Preferences
              </h4>
              <ul className="ml-4 space-y-1 text-sm text-foreground">
                <li>
                  • Transcription model (e.g., &quot;Whisper large-v3&quot;, &quot;Parakeet&quot;)
                </li>
                <li>• Summary model (e.g., &quot;Llama 3.2&quot;, &quot;Claude Sonnet&quot;)</li>
                <li>
                  • Model provider (e.g., &quot;Local&quot;, &quot;Ollama&quot;, &quot;OpenRouter&quot;)
                </li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground italic">
                Helps us understand which models users prefer
              </p>
            </div>

            {/* Meeting Metrics */}
            <div className="rounded-lg border border-border p-4">
              <h4 className="mb-2 font-semibold text-foreground">
                2. Anonymous Meeting Metrics
              </h4>
              <ul className="ml-4 space-y-1 text-sm text-foreground">
                <li>• Recording duration (e.g., &quot;125 seconds&quot;)</li>
                <li>• Pause duration (e.g., &quot;5 seconds&quot;)</li>
                <li>• Number of transcript segments</li>
                <li>• Number of audio chunks processed</li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground italic">
                Helps us optimize performance and understand usage patterns
              </p>
            </div>

            {/* Device Types */}
            <div className="rounded-lg border border-border p-4">
              <h4 className="mb-2 font-semibold text-foreground">
                3. Device Types (Not Names)
              </h4>
              <ul className="ml-4 space-y-1 text-sm text-foreground">
                <li>• Microphone type: &quot;Bluetooth&quot; or &quot;Wired&quot; or &quot;Unknown&quot;</li>
                <li>
                  • System audio type: &quot;Bluetooth&quot; or &quot;Wired&quot; or &quot;Unknown&quot;
                </li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground italic">
                Helps us improve compatibility, NOT the actual device names
              </p>
            </div>

            {/* Usage Patterns */}
            <div className="rounded-lg border border-border p-4">
              <h4 className="mb-2 font-semibold text-foreground">
                4. App Usage Patterns
              </h4>
              <ul className="ml-4 space-y-1 text-sm text-foreground">
                <li>• App started/stopped events</li>
                <li>• Session duration</li>
                <li>• Feature usage (e.g., &quot;settings changed&quot;)</li>
                <li>• Error occurrences (helps us fix bugs)</li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground italic">
                Helps us improve user experience
              </p>
            </div>

            {/* Platform Info */}
            <div className="rounded-lg border border-border p-4">
              <h4 className="mb-2 font-semibold text-foreground">
                5. Platform Information
              </h4>
              <ul className="ml-4 space-y-1 text-sm text-foreground">
                <li>• Operating system (e.g., &quot;macOS&quot;, &quot;Windows&quot;)</li>
                <li>• App version (automatically included in all events)</li>
                <li>• Architecture (e.g., &quot;x86_64&quot;, &quot;aarch64&quot;)</li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground italic">
                Helps us prioritize platform support
              </p>
            </div>
          </div>

          {/* What We DON'T Collect */}
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h4 className="mb-2 font-semibold text-red-900">
              What We DON&apos;T Collect:
            </h4>
            <ul className="ml-4 space-y-1 text-sm text-red-800">
              <li>• ❌ Meeting names or titles</li>
              <li>• ❌ Meeting transcripts or content</li>
              <li>• ❌ Audio recordings</li>
              <li>• ❌ Device names (only types: Bluetooth/Wired)</li>
              <li>• ❌ Personal information</li>
              <li>• ❌ Any identifiable data</li>
            </ul>
          </div>

          {/* Example Event */}
          <div className="rounded-lg border border-border bg-muted p-4">
            <h4 className="mb-2 font-semibold text-foreground">
              Example Event:
            </h4>
            <pre className="overflow-x-auto text-xs text-foreground">
              {`{
  "event": "meeting_ended",
  "app_version": "0.3.0",
  "transcription_provider": "parakeet",
  "transcription_model": "parakeet-tdt-0.6b-v3-int8",
  "summary_provider": "ollama",
  "summary_model": "llama3.2:latest",
  "total_duration_seconds": "125.5",
  "microphone_device_type": "Wired",
  "system_audio_device_type": "Bluetooth",
  "chunks_processed": "150",
  "had_fatal_error": "false"
}`}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="
          flex items-center justify-between gap-4 border-t border-border
          bg-muted p-6
        ">
          <button
            onClick={onClose}
            className="
              rounded-md border border-border bg-background px-4 py-2
              text-foreground transition-colors
              hover:bg-muted
            "
          >
            Keep Analytics Enabled
          </button>
          <button
            onClick={onConfirmDisable}
            className="
              rounded-md bg-red-600 px-4 py-2 text-white transition-colors
              hover:bg-red-700
            "
          >
            Confirm: Disable Analytics
          </button>
        </div>
      </div>
    </div>
  );
}
