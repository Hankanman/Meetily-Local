interface StatusOverlaysProps {
  // Status flags
  isProcessing: boolean; // Processing transcription after recording stops
  isSaving: boolean; // Saving transcript to database

  // Layout
  sidebarCollapsed: boolean; // For responsive margin calculation
}

// Internal reusable component for individual status overlays
interface StatusOverlayProps {
  show: boolean;
  message: string;
  sidebarCollapsed: boolean;
}

function StatusOverlay({
  show,
  message,
  sidebarCollapsed,
}: StatusOverlayProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-10">
      <div
        className="flex justify-center pl-8 transition-[margin] duration-300"
        style={{
          marginLeft: sidebarCollapsed ? "4rem" : "16rem",
        }}
      >
        <div className="flex w-2/3 max-w-187.5 justify-center">
          <div
            className="
            flex items-center space-x-2 rounded-lg bg-background px-4 py-2
            shadow-lg
          "
          >
            <div
              className="
              size-4 animate-spin rounded-full border-b-2 border-gray-900
            "
            ></div>
            <span className="text-sm text-foreground">{message}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Main exported component - renders multiple status overlays
export function StatusOverlays({
  isProcessing,
  isSaving,
  sidebarCollapsed,
}: StatusOverlaysProps) {
  return (
    <>
      {/* Processing status overlay - shown after recording stops while finalizing transcription */}
      <StatusOverlay
        show={isProcessing}
        message="Finalizing transcription..."
        sidebarCollapsed={sidebarCollapsed}
      />

      {/* Saving status overlay - shown while saving transcript to database */}
      <StatusOverlay
        show={isSaving}
        message="Saving transcript..."
        sidebarCollapsed={sidebarCollapsed}
      />
    </>
  );
}
