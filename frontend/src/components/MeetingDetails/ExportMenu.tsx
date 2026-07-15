"use client";

import { useState } from "react";
import { Copy, Download, FileJson, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  ExportFormat,
  exportMeeting,
  exportMeetingToFile,
} from "@/lib/actionItems";

interface ExportMenuProps {
  meetingId: string;
}

/**
 * Export the whole meeting — summary, action items, attendees and the full
 * speaker-attributed transcript — as one self-contained document.
 *
 * Copy is the primary path (the common case is pasting into a chat with an
 * LLM); saving to a file is there for the archival case. Markdown for humans
 * and models, JSON for tools.
 */
export function ExportMenu({ meetingId }: ExportMenuProps) {
  const [isBusy, setIsBusy] = useState(false);

  const handleCopy = async (format: ExportFormat) => {
    setIsBusy(true);
    try {
      const result = await exportMeeting(meetingId, format);
      await navigator.clipboard.writeText(result.content);
      toast.success(
        `Meeting copied as ${format === "json" ? "JSON" : "Markdown"}`,
      );
    } catch (err) {
      console.error("Failed to export meeting:", err);
      toast.error(typeof err === "string" ? err : "Failed to export meeting");
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = async (format: ExportFormat) => {
    setIsBusy(true);
    try {
      const path = await exportMeetingToFile(meetingId, format);
      // A null path means the user cancelled the save dialog — not an error,
      // and not worth a toast.
      if (path) toast.success("Meeting exported");
    } catch (err) {
      console.error("Failed to export meeting:", err);
      toast.error(typeof err === "string" ? err : "Failed to export meeting");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isBusy}
          title="Export meeting (summary, action items and transcript)"
          className="cursor-pointer"
        >
          {isBusy ? <Spinner size="sm" /> : <Download />}
          <span className="
            hidden
            lg:inline
          ">Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Summary, action items & transcript
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleCopy("markdown")}>
          <Copy className="mr-2 size-3.5" />
          Copy as Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleCopy("json")}>
          <Copy className="mr-2 size-3.5" />
          Copy as JSON
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleSave("markdown")}>
          <FileText className="mr-2 size-3.5" />
          Save as Markdown…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleSave("json")}>
          <FileJson className="mr-2 size-3.5" />
          Save as JSON…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
