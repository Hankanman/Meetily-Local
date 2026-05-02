"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { UpdateInfo } from "@/services/updateService";
import { UpdateDialog } from "./UpdateDialog";
import {
  setUpdateDialogCallback,
  showUpdateNotification,
} from "./UpdateNotification";

interface UpdateCheckContextType {
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  checkForUpdates: (force?: boolean) => Promise<void>;
  showUpdateDialog: () => void;
}

const UpdateCheckContext = createContext<UpdateCheckContextType | undefined>(
  undefined,
);

export function UpdateCheckProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showDialog, setShowDialog] = useState(false);

  const handleShowDialog = useCallback(() => {
    setShowDialog(true);
  }, []);

  const { updateInfo, isChecking, checkForUpdates } = useUpdateCheck({
    // Auto-check disabled until the Meetily-Local fork starts publishing
    // signed `latest.json` release manifests. Manual "Check for updates"
    // (About panel + tray menu) still works — those just hit the same
    // endpoint and surface any error inline.
    checkOnMount: false,
    showNotification: true,
    onUpdateAvailable: (info) => {
      // Show notification, dialog will be shown when user clicks notification
      showUpdateNotification(info, handleShowDialog);
    },
  });

  useEffect(() => {
    // Register the callback so UpdateNotification can trigger the dialog
    setUpdateDialogCallback(handleShowDialog);
    return () => {
      setUpdateDialogCallback(() => {});
    };
  }, [handleShowDialog]);

  // Listen for tray menu events
  useEffect(() => {
    const handleTrayCheck = () => {
      checkForUpdates(true); // Force check from tray
      setShowDialog(true);
    };

    window.addEventListener("check-updates-from-tray", handleTrayCheck);
    return () =>
      window.removeEventListener("check-updates-from-tray", handleTrayCheck);
  }, [checkForUpdates]);

  return (
    <UpdateCheckContext.Provider
      value={{
        updateInfo,
        isChecking,
        checkForUpdates,
        showUpdateDialog: handleShowDialog,
      }}
    >
      {children}
      <UpdateDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        updateInfo={updateInfo}
      />
    </UpdateCheckContext.Provider>
  );
}

export function useUpdateCheckContext() {
  const context = useContext(UpdateCheckContext);
  if (context === undefined) {
    throw new Error(
      "useUpdateCheckContext must be used within UpdateCheckProvider",
    );
  }
  return context;
}
