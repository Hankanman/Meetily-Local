import React from "react";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { WelcomeStep, DownloadProgressStep, SetupOverviewStep } from "./steps";

// Onboarding completion is propagated through OnboardingContext (the
// `completed` flag flips to true via `completeOnboarding()`); RootContent
// re-renders into the main app on the next tick. No completion callback
// needed at this layer.
export function OnboardingFlow() {
  const { currentStep } = useOnboarding();

  // 3-Step Onboarding Flow (System-Recommended Models):
  // Step 1: Welcome - Introduce Meetily features
  // Step 2: Setup Overview - Database initialization + show recommended downloads
  // Step 3: Download Progress — Download Whisper + Gemma (auto-selected based on RAM),
  //         then completes onboarding directly (no separate permissions step on Linux)

  return (
    <div className="onboarding-flow">
      {currentStep === 1 && <WelcomeStep />}
      {currentStep === 2 && <SetupOverviewStep />}
      {currentStep === 3 && <DownloadProgressStep />}
    </div>
  );
}
