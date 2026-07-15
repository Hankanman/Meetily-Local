"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Heading, Text } from "@/components/ui/typography";

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
 * Single source of truth for "a group of related settings on a card" — a thin,
 * settings-flavoured wrapper over the `Card` primitive with a title/description
 * header built from the typography primitives. Replaces the previously
 * inconsistent inline patterns (`rounded-lg border p-4` /
 * `rounded-lg border bg-background p-6 shadow-sm`) so every settings section
 * reads the same.
 */
export function SettingsCard({
  title,
  description,
  children,
  className = "",
}: SettingsCardProps) {
  return (
    <Card className={cn("p-5", className)}>
      {(title || description) && (
        <div className="mb-4">
          {title && <Heading level={3}>{title}</Heading>}
          {description && (
            <Text size="small" tone="muted" className="mt-1">
              {description}
            </Text>
          )}
        </div>
      )}
      {children}
    </Card>
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
