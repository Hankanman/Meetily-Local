import React from "react";

interface ConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  text: string;
  isOpen: boolean;
}

export function ConfirmationModal({
  onConfirm,
  onCancel,
  text,
  isOpen,
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="
      bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center
      bg-foreground
    ">
      <div className="mx-4 w-full max-w-md rounded-lg bg-background p-6">
        <h2 className="mb-4 text-xl font-semibold">Confirm Delete</h2>
        <p className="mb-6 text-muted-foreground">{text}</p>
        <div className="flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="
              rounded-md px-4 py-2 text-muted-foreground transition-colors
              hover:bg-muted
            "
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="
              rounded-md bg-red-600 px-4 py-2 text-white transition-colors
              hover:bg-red-700
            "
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
