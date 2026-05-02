import React from "react";
import { Lock, Sparkles, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingContainer } from "../OnboardingContainer";
import { useOnboarding } from "@/contexts/OnboardingContext";

export function WelcomeStep() {
  const { goNext } = useOnboarding();

  const features = [
    {
      icon: Lock,
      title: "Your data never leaves your device",
    },
    {
      icon: Sparkles,
      title: "Intelligent summaries & insights",
    },
    {
      icon: Cpu,
      title: "Works offline, no cloud required",
    },
  ];

  return (
    <OnboardingContainer
      title="Welcome to Meetily"
      description="Record. Transcribe. Summarize. All on your device."
      step={1}
      hideProgress={true}
    >
      <div className="flex flex-col items-center space-y-10">
        {/* Divider */}
        <div className="h-px w-16 bg-muted" />

        {/* Features Card */}
        <div className="
          w-full max-w-md space-y-4 rounded-lg border border-border
          bg-background p-6 shadow-sm
        ">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={index} className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  <div className="
                    flex size-5 items-center justify-center rounded-full
                    bg-muted
                  ">
                    <Icon className="size-3 text-foreground" />
                  </div>
                </div>
                <p className="text-sm/relaxed text-foreground">
                  {feature.title}
                </p>
              </div>
            );
          })}
        </div>

        {/* CTA Section */}
        <div className="w-full max-w-xs space-y-3">
          <Button
            onClick={goNext}
            className="
              h-11 w-full bg-foreground text-white
              hover:bg-foreground/90
            "
          >
            Get Started
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Takes less than 3 minutes
          </p>
        </div>
      </div>
    </OnboardingContainer>
  );
}
