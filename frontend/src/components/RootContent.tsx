"use client";

import Sidebar from "@/components/Sidebar";
import MainContent from "@/components/MainContent";
import { OnboardingFlow } from "@/components/onboarding";
import { useOnboarding } from "@/contexts/OnboardingContext";

// Picks between the onboarding flow and the main app based on the single
// source of truth in OnboardingContext. When the user finishes onboarding,
// `completed` flips to true and React re-renders into the main app — no
// page reload required.
export function RootContent({ children }: { children: React.ReactNode }) {
  const { completed, isStatusLoading } = useOnboarding();

  if (isStatusLoading) {
    // Empty pane until we've loaded the persisted status, to avoid a flash
    // of either the onboarding flow or the main app.
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
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <Sidebar />
      <MainContent>{children}</MainContent>
    </div>
  );
}
