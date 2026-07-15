import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import type { RecordingPreferences } from "@/components/RecordingSettings";

/**
 * Shows the recording notification toast with compliance message.
 * Checks user preferences and displays a dismissible toast with:
 * - notice to inform participants
 * - "Don't show again" checkbox
 * - Acknowledgment button
 *
 * @returns Promise<void> - Resolves when notification is shown or skipped
 */
export async function showRecordingNotification(): Promise<void> {
  try {
    const preferences = await invoke<RecordingPreferences>(
      "get_recording_preferences",
    );
    const showNotification = preferences.show_recording_notification ?? true;

    if (showNotification) {
      let dontShowAgain = false;

      const toastId = toast.info("🔴 Recording Started", {
        description: (
          <div className="min-w-70 space-y-3">
            <p className="text-sm font-medium text-foreground">
              Inform all participants this meeting is being recorded.
            </p>
            <label
              className="
              flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm
              transition-colors
              hover:bg-info/15
            "
            >
              <input
                type="checkbox"
                onChange={(e) => {
                  dontShowAgain = e.target.checked;
                }}
                className="
                  rounded-md border-border text-info
                  focus:ring-2 focus:ring-info
                "
              />
              <span className="text-foreground select-none">
                Don&apos;t show this again
              </span>
            </label>
            <Button
              size="sm"
              onClick={async () => {
                if (dontShowAgain) {
                  try {
                    await invoke("set_recording_preferences", {
                      preferences: {
                        ...preferences,
                        show_recording_notification: false,
                      },
                    });
                  } catch (error) {
                    console.error(
                      "Failed to save notification preference:",
                      error,
                    );
                  }
                }
                toast.dismiss(toastId);
              }}
              className="w-full bg-foreground text-white hover:bg-foreground/90"
            >
              I&apos;ve Notified Participants
            </Button>
          </div>
        ),
        duration: 10000,
        position: "bottom-right",
      });
    }
  } catch (notificationError) {
    console.error("Failed to show recording notification:", notificationError);
    // Don't fail the recording if notification fails
  }
}
