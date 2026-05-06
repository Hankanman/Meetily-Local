"use client";

import type { ReactNode } from "react";

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
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>
      <div className="flex-1 px-8 py-6">{children}</div>
    </section>
  );
}
