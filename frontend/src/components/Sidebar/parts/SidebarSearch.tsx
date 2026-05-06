"use client";

import { Search, X } from "lucide-react";

interface SidebarSearchProps {
  value: string;
  onChange: (next: string) => void;
  isSearching?: boolean;
}

/**
 * Search input that filters meetings by title and matches transcript
 * content. The actual transcript-search RPC is fired by the parent on
 * change; this component is a controlled input + a clear button.
 */
export function SidebarSearch({
  value,
  onChange,
  isSearching = false,
}: SidebarSearchProps) {
  return (
    <div className="relative">
      <Search className="
        pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2
        text-muted-foreground
      " />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search meetings…"
        className="
          h-9 w-full rounded-md border border-border bg-muted/40 pr-8 pl-8
          text-sm placeholder:text-muted-foreground/70
          focus:border-ring focus:bg-background focus:ring-1 focus:ring-ring
          focus:outline-none
        "
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="
            absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5
            text-muted-foreground transition-colors
            hover:bg-muted hover:text-foreground
          "
        >
          <X className="size-3.5" />
        </button>
      )}
      {isSearching && (
        <span className="
          absolute -bottom-4 left-2 text-xs text-muted-foreground
        ">
          Searching transcripts…
        </span>
      )}
    </div>
  );
}
