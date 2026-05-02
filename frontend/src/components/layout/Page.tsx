"use client";

import type { ReactNode } from "react";

// The chrome every page shares: fills the main region, owns the muted
// background, sets up a flex column so children (header + body + floating
// docks) can position themselves predictably. Pages MUST NOT redeclare
// `h-screen` / `flex-col` / `bg-muted` — that's all here.
//
// `relative` makes this the positioning ancestor for `<FloatingBottomDock>`
// and friends, so floating UI never has to know about sidebar width.
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-muted">
      {children}
    </div>
  );
}

// Scrollable content region inside `<Page>`. Use for the main flow content
// (transcript list, settings panels, etc).
export function PageBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-h-0 flex-1 overflow-auto ${className}`}>
      {children}
    </div>
  );
}

// Standard "still loading" placeholder. Replaces the
// `flex h-screen items-center justify-center` boilerplate that was duplicated
// across every page.
export function PageLoading({ children }: { children?: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-muted">
      {children}
    </div>
  );
}

// A sticky-bottom region for floating UI (recording controls, transient
// status overlays, etc). Anchored to the closest positioned ancestor —
// when used inside `<Page>` that's the page itself, so floating UI grows
// with the main content and ignores the sidebar entirely.
export function FloatingBottomDock({
  children,
  bottomOffset = "bottom-12",
}: {
  children: ReactNode;
  bottomOffset?: string;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center ${bottomOffset}`}
    >
      <div className="pointer-events-auto">{children}</div>
    </div>
  );
}
