import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

// Single source of truth for "loading" UI. Replaces the three previous
// patterns: `<Loader2>`, `<LoaderIcon>`, and the hand-rolled
// `<div className="animate-spin border-b-2 ...">`. Use `size="sm"` for inline
// (in buttons), "md" for default, "lg" for full-page loading.
const SIZE_CLASSES: Record<NonNullable<SpinnerProps["size"]>, string> = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <Loader2
      className={cn("animate-spin text-muted-foreground", SIZE_CLASSES[size], className)}
      aria-hidden="true"
    />
  );
}
