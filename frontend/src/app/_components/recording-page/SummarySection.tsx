"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

interface SummarySectionProps {
  /** Uppercase mono eyebrow title, e.g. "Recent meetings". */
  title: string;
  /** Optional count shown as a brand badge next to the title. Hidden when 0. */
  count?: number;
  /** Optional control rendered on the right of the header (e.g. a "View all"). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Home-screen summary section shell — an eyebrow-titled block with an optional
 * count badge and a vertically-stacked body. Shared by the recent-meetings and
 * outstanding-action-items summaries so both read as one system.
 */
export function SummarySection({
  title,
  count,
  action,
  children,
  className = "",
}: SummarySectionProps) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="eyebrow">{title}</span>
          {count != null && count > 0 && <Badge variant="brand">{count}</Badge>}
        </div>
        {action}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}
