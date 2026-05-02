"use client";

import Sidebar from "@/components/Sidebar";
import { OnboardingFlow } from "@/components/onboarding";
import { useOnboarding } from "@/contexts/OnboardingContext";

// The application frame: sidebar on the left, main content area on the right.
// This is the ONLY component that knows there's a sidebar at all — pages
// just render their content inside `<main>`.
//
// `<main>` is the positioning ancestor for any `position: absolute` UI inside
// pages (recording dock, status overlays). That means floating UI never has
// to know about the sidebar's collapsed width.
//
// Renders the onboarding flow instead of the shell when onboarding hasn't
// been completed.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { completed, isStatusLoading } = useOnboarding();

  if (isStatusLoading) {
    return <div className="min-h-0 flex-1 overflow-hidden bg-background" />;
  }

  if (!completed) {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <OnboardingFlow />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-muted">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
