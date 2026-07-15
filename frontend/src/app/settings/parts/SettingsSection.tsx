"use client";

import type { ReactNode } from "react";

import { Heading, Text } from "@/components/ui/typography";

interface SettingsSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

/**
 * Right-panel wrapper for one settings category. Renders a consistent
 * page-style heading (title + one-line description) above whatever
 * settings component is being shown, so each section reads the same way
 * regardless of which `<XxxSettings />` component is mounted under it.
 */
export function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <section className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-border px-8 pt-8 pb-4">
        <Heading level={1} as="h2">{title}</Heading>
        <Text size="small" tone="muted" className="mt-1">
          {description}
        </Text>
      </header>
      <div className="flex-1 px-8 py-6">{children}</div>
    </section>
  );
}
