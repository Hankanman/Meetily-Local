import React from "react";
import { Upload } from "lucide-react";
import { Heading } from "@/components/ui/typography";
import { getAudioFormatsDisplayList } from "@/constants/audioFormats";

interface ImportDropOverlayProps {
  visible: boolean;
}

export function ImportDropOverlay({ visible }: ImportDropOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="
        pointer-events-none fixed inset-0 z-50 flex items-center justify-center
        bg-foreground/60 backdrop-blur-sm transition-opacity duration-200
      "
    >
      <div
        className="
          scale-100 transform rounded-lg border-2 border-dashed border-info
          bg-info-muted p-12 text-center shadow-lg transition-transform
        "
      >
        <Upload className="mx-auto mb-4 size-16 text-info" />
        <Heading level={2} className="text-white">
          Drop audio file to import
        </Heading>
        <p className="mt-2 text-sm text-info/80">
          {getAudioFormatsDisplayList()}
        </p>
      </div>
    </div>
  );
}
