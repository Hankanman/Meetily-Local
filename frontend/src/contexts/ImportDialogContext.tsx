"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useConfig } from "./ConfigContext";
import { toast } from "sonner";
import {
  ImportAudioDialog,
  ImportDropOverlay,
} from "@/components/ImportAudio";

interface ImportDialogContextType {
  // Open the import dialog, optionally pre-selecting a file path.
  openImportDialog: (filePath?: string | null) => void;
  // Show/hide the full-screen drop target overlay (driven by the file-drop bridge).
  setShowDropOverlay: (visible: boolean) => void;
}

const ImportDialogContext = createContext<ImportDialogContextType | null>(null);

export const useImportDialog = () => {
  const ctx = useContext(ImportDialogContext);
  if (!ctx)
    throw new Error("useImportDialog must be used within ImportDialogProvider");
  return ctx;
};

// Self-contained: owns the dialog and overlay state and renders both. The
// previous version received an `onOpen` callback and let the parent host the
// state and dialog separately, which forced an awkward `ConditionalImportDialog`
// shim and split the concern across two files.
export function ImportDialogProvider({ children }: { children: ReactNode }) {
  const { betaFeatures } = useConfig();
  const [open, setOpen] = useState(false);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [showDropOverlay, setShowDropOverlay] = useState(false);

  const openImportDialog = useCallback(
    (next?: string | null) => {
      // Gate: beta feature flag must be on
      if (!betaFeatures.importAndRetranscribe) {
        toast.error("Beta feature disabled", {
          description:
            'Enable "Import Audio & Retranscribe" in Settings > Beta to use this feature.',
        });
        return;
      }
      setFilePath(next ?? null);
      setOpen(true);
    },
    [betaFeatures],
  );

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setFilePath(null);
  }, []);

  return (
    <ImportDialogContext.Provider
      value={{ openImportDialog, setShowDropOverlay }}
    >
      {children}
      <ImportDropOverlay visible={showDropOverlay} />
      {/* Only mount the dialog (and its hooks/listeners) when the feature is enabled */}
      {betaFeatures.importAndRetranscribe && (
        <ImportAudioDialog
          open={open}
          onOpenChange={handleOpenChange}
          preselectedFile={filePath}
        />
      )}
    </ImportDialogContext.Provider>
  );
}
