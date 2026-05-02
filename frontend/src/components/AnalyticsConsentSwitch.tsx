import React, { useContext, useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Info, Loader2, Copy, Check } from "lucide-react";
import { AnalyticsContext } from "./AnalyticsProvider";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { Analytics } from "@/lib/analytics";
import AnalyticsDataModal from "./AnalyticsDataModal";

export default function AnalyticsConsentSwitch() {
  const { setIsAnalyticsOptedIn, isAnalyticsOptedIn } =
    useContext(AnalyticsContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [isCopied, setIsCopied] = useState(false);

  // Note: Store loading is handled by AnalyticsProvider to avoid race conditions

  useEffect(() => {
    const loadUserId = async () => {
      if (isAnalyticsOptedIn) {
        try {
          const id = await Analytics.getPersistentUserId();
          setUserId(id);
        } catch (error) {
          console.error("Failed to load user ID:", error);
        }
      } else {
        setUserId("");
      }
    };
    loadUserId();
  }, [isAnalyticsOptedIn]);

  const handleCopyUserId = async () => {
    if (!userId) return;

    try {
      await navigator.clipboard.writeText(userId);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);

      // Track that user copied their ID
      await Analytics.track("user_id_copied", {
        user_id: userId,
      });
    } catch (error) {
      console.error("Failed to copy user ID:", error);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    // If user is trying to DISABLE, show the modal first
    if (!enabled) {
      setShowModal(true);
      // Track that user viewed the transparency modal
      try {
        await invoke("track_analytics_transparency_viewed");
      } catch (error) {
        console.error("Failed to track transparency view:", error);
      }
      return; // Don't disable yet, wait for modal confirmation
    }

    // If ENABLING, proceed immediately
    await performToggle(enabled);
  };

  const performToggle = async (enabled: boolean) => {
    // Optimistic update - immediately update UI state
    setIsAnalyticsOptedIn(enabled);
    setIsProcessing(true);

    try {
      const store = await load("analytics.json", {
        autoSave: false,
        defaults: {
          analyticsOptedIn: true,
        },
      });
      await store.set("analyticsOptedIn", enabled);
      await store.save();

      if (enabled) {
        // Full analytics initialization (same as AnalyticsProvider)
        const userId = await Analytics.getPersistentUserId();

        // Initialize analytics
        await Analytics.init();

        // Identify user with enhanced properties immediately after init
        await Analytics.identify(userId, {
          app_version: "0.3.0",
          platform: "tauri",
          first_seen: new Date().toISOString(),
          os: navigator.platform,
          user_agent: navigator.userAgent,
        });

        // Start analytics session with the same user ID
        await Analytics.startSession(userId);

        // Track app started (re-enabled)
        await Analytics.trackAppStarted();

        // Track that user enabled analytics
        try {
          await invoke("track_analytics_enabled");
        } catch (error) {
          console.error("Failed to track analytics enabled:", error);
        }

        console.log("Analytics re-enabled successfully");
      } else {
        // Track that user disabled analytics BEFORE disabling
        try {
          await invoke("track_analytics_disabled");
        } catch (error) {
          console.error("Failed to track analytics disabled:", error);
        }

        await Analytics.disable();
        console.log("Analytics disabled successfully");
      }
    } catch (error) {
      console.error("Failed to toggle analytics:", error);
      // Revert the optimistic update on error
      setIsAnalyticsOptedIn(!enabled);
      // You could also show a toast notification here to inform the user
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmDisable = async () => {
    setShowModal(false);
    await performToggle(false);
  };

  const handleCancelDisable = () => {
    setShowModal(false);
    // Keep analytics enabled, no state change needed
  };

  const handlePrivacyPolicyClick = async () => {
    try {
      await invoke("open_external_url", {
        url: "https://github.com/Zackriya-Solutions/meeting-minutes/blob/main/PRIVACY_POLICY.md",
      });
    } catch (error) {
      console.error("Failed to open privacy policy link:", error);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div>
          <h3 className="mb-2 text-base font-semibold text-foreground">
            Usage Analytics
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Help us improve Meetily by sharing anonymous usage data. No personal
            content is collected—everything stays on your device.
          </p>
        </div>

        <div className="
          flex items-center justify-between rounded-lg border border-border
          bg-muted p-3
        ">
          <div>
            <h4 className="font-semibold text-foreground">Enable Analytics</h4>
            <p className="text-sm text-muted-foreground">
              {isProcessing ? "Updating..." : "Anonymous usage patterns only"}
            </p>
          </div>
          <div className="ml-4 flex items-center gap-2">
            {isProcessing && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
            <Switch
              checked={isAnalyticsOptedIn}
              onCheckedChange={handleToggle}
              disabled={isProcessing}
            />
          </div>
        </div>

        {/* User ID Display */}
        {isAnalyticsOptedIn && userId && (
          <div className="rounded-lg border bg-muted p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 font-medium text-foreground">
                  Your User ID
                </div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Share this ID when reporting issues to help us investigate
                  your issue logs
                </p>
                <div className="flex items-center gap-2">
                  <code className="
                    flex-1 truncate rounded-sm border border-border
                    bg-background px-2 py-1 font-mono text-xs text-foreground
                  ">
                    {userId}
                  </code>
                  <Button
                    onClick={handleCopyUserId}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    title="Copy User ID"
                  >
                    {isCopied ? (
                      <>
                        <Check className="size-3.5 text-green-600" />
                        <span className="text-green-600">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="
          flex items-start gap-2 rounded-sm border border-blue-500/30
          bg-blue-600/10 p-2
        ">
          <Info className="mt-0.5 size-4 shrink-0 text-blue-600" />
          <div className="text-xs text-blue-700">
            <p className="mb-1">
              Your meetings, transcripts, and recordings remain completely
              private and local.
            </p>
            <button
              onClick={handlePrivacyPolicyClick}
              className="
                text-blue-600 underline
                hover:text-blue-800 hover:no-underline
              "
            >
              View Privacy Policy
            </button>
          </div>
        </div>
      </div>

      {/* 2-Step Opt-Out Modal */}
      <AnalyticsDataModal
        isOpen={showModal}
        onClose={handleCancelDisable}
        onConfirmDisable={handleConfirmDisable}
      />
    </>
  );
}
