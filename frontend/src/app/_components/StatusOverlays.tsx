import { FloatingBottomDock } from "@/components/layout/Page";
import { Spinner } from "@/components/ui/spinner";

interface StatusOverlaysProps {
  isProcessing: boolean; // Processing transcription after recording stops
  isSaving: boolean; // Saving transcript to database
}

function StatusOverlay({ show, message }: { show: boolean; message: string }) {
  if (!show) return null;
  return (
    <FloatingBottomDock bottomOffset="bottom-4">
      <div className="
        flex items-center space-x-2 rounded-lg bg-background px-4 py-2
        shadow-lg
      ">
        <Spinner size="sm" className="text-foreground" />
        <span className="text-sm text-foreground">{message}</span>
      </div>
    </FloatingBottomDock>
  );
}

// Renders the "finalizing" / "saving" toasts that appear at the bottom of the
// main region after a recording stops. Anchored to the page (via
// FloatingBottomDock), so the sidebar's collapse state is irrelevant.
export function StatusOverlays({ isProcessing, isSaving }: StatusOverlaysProps) {
  return (
    <>
      <StatusOverlay show={isProcessing} message="Finalizing transcription..." />
      <StatusOverlay show={isSaving} message="Saving transcript..." />
    </>
  );
}
