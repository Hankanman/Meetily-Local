import React from "react";
import { Upload } from "lucide-react";
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
          scale-100 transform rounded-2xl border-2 border-dashed border-blue-400
          bg-blue-950/50 p-12 text-center shadow-2xl transition-transform
        "
      >
        <Upload className="mx-auto mb-4 size-16 text-blue-400" />
        <p className="text-xl font-medium text-white">
          Drop audio file to import
        </p>
        <p className="mt-2 text-sm text-blue-300">
          {getAudioFormatsDisplayList()}
        </p>
      </div>
    </div>
  );
}
