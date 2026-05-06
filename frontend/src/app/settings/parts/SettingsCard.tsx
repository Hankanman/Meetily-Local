"use client";

import type { ReactNode } from "react";

interface SettingsCardProps {
  /** Optional small section heading inside the card. Use for sub-groups
   *  within a single settings panel — not for the panel's own page-level
   *  title (the parent `<SettingsSection>` already provides that). */
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Single source of truth for "a group of related settings on a card".
 * Replaces the previously-inconsistent inline patterns
 * (`rounded-lg border p-4` / `rounded-lg border bg-muted p-4` /
 * `rounded-lg border bg-background p-6 shadow-sm`) so every section
 * inside a settings panel reads the same.
 */
export function SettingsCard({
  title,
  description,
  children,
  className = "",
}: SettingsCardProps) {
  return (
    <div
      className={`
        rounded-lg border border-border bg-card p-5 shadow-sm
        ${className}
      `}
    >
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          )}
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

interface SettingsRowProps {
  /** Bold label on the left side of the row. */
  label: string;
  /** Smaller description below the label. */
  description?: string;
  /** Control rendered on the right (toggle, button, select, etc.). */
  children: ReactNode;
}

/**
 * One label/description-on-left, control-on-right row. Common shape
 * across notification toggles, save-folder buttons, default-model
 * selects, etc.
 */
export function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
