"use client";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Spinner } from "@/components/ui/spinner";
import { Copy, Save, Search, FolderOpen } from "lucide-react";

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onFind?: () => void;
  onOpenFolder: () => Promise<void>;
  hasSummary: boolean;
}

export function SummaryUpdaterButtonGroup({
  isSaving,
  isDirty,
  onSave,
  onCopy,
  onFind,
  onOpenFolder,
  hasSummary,
}: SummaryUpdaterButtonGroupProps) {
  return (
    <ButtonGroup>
      {/* Save button */}
      <Button
        variant="outline"
        size="sm"
        className={
          isDirty
            ? "border-success bg-success text-white hover:bg-success"
            : ""
        }
        title={isSaving ? "Saving" : "Save Changes"}
        onClick={onSave}
        disabled={isSaving}
      >
        {isSaving ? (
          <>
            <Spinner size="sm" />
            <span className="
              hidden
              lg:inline
            ">Saving...</span>
          </>
        ) : (
          <>
            <Save />
            <span className="
              hidden
              lg:inline
            ">Save</span>
          </>
        )}
      </Button>

      {/* Copy button */}
      <Button
        variant="outline"
        size="sm"
        title="Copy Summary"
        onClick={onCopy}
        disabled={!hasSummary}
        className="cursor-pointer"
      >
        <Copy />
        <span className="
          hidden
          lg:inline
        ">Copy</span>
      </Button>

    </ButtonGroup>
  );
}
