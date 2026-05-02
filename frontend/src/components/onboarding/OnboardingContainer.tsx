import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressIndicator } from "./shared/ProgressIndicator";
import { useOnboarding } from "@/contexts/OnboardingContext";
import type { OnboardingContainerProps } from "@/types/onboarding";

export function OnboardingContainer({
  title,
  description,
  children,
  step,
  totalSteps = 5,
  stepOffset = 0,
  hideProgress = false,
  className,
  showNavigation = false,
  onNext,
  onPrevious,
  canGoNext = true,
  canGoPrevious = true,
}: OnboardingContainerProps) {
  const { goToStep, goPrevious, goNext } = useOnboarding();

  const handlePrevious = () => {
    if (onPrevious) {
      onPrevious();
    } else {
      goPrevious();
    }
  };

  const handleNext = () => {
    if (onNext) {
      onNext();
    } else {
      goNext();
    }
  };

  const handleStepClick = (s: number) => {
    goToStep(s + stepOffset);
  };

  return (
    <div className="
      fixed inset-0 z-50 flex items-center justify-center overflow-hidden
      bg-muted
    ">
      <div
        className={cn(
          "flex size-full max-h-screen max-w-2xl flex-col p-6",
          className,
        )}
      >
        {/* Progress Indicator with Navigation - Fixed */}
        {step && !hideProgress && (
          <div className="relative mb-2 shrink-0">
            {/* Navigation Buttons */}
            {showNavigation && (
              <div className="
                pointer-events-none absolute inset-x-0 top-1/2 flex
                -translate-y-1/2 justify-between
              ">
                <button
                  onClick={handlePrevious}
                  disabled={!canGoPrevious || step === 1}
                  className={cn(
                    `
                      pointer-events-auto flex size-8 items-center
                      justify-center rounded-full border border-border
                      bg-background shadow-sm transition-all duration-200
                    `,
                    canGoPrevious && step !== 1
                      ? `
                        text-foreground
                        hover:scale-110 hover:bg-muted hover:shadow-md
                      `
                      : "cursor-not-allowed opacity-0",
                  )}
                >
                  <ChevronLeft className="size-4" />
                </button>

                <button
                  onClick={handleNext}
                  disabled={!canGoNext || step === totalSteps}
                  className={cn(
                    `
                      pointer-events-auto flex size-8 items-center
                      justify-center rounded-full border border-border
                      bg-background shadow-sm transition-all duration-200
                    `,
                    canGoNext && step !== totalSteps
                      ? `
                        text-foreground
                        hover:scale-110 hover:bg-muted hover:shadow-md
                      `
                      : "cursor-not-allowed opacity-0",
                  )}
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}

            {/* Progress Indicator */}
            <ProgressIndicator
              current={step}
              total={totalSteps}
              onStepClick={handleStepClick}
            />
          </div>
        )}

        {/* Header - Fixed */}
        <div className="mb-4 shrink-0 space-y-3 text-center">
          <h1 className="
            animate-fade-in-up text-4xl font-semibold text-foreground
          ">
            {title}
          </h1>
          {description && (
            <p className="
              animate-fade-in-up mx-auto max-w-md text-base
              text-muted-foreground delay-75
            ">
              {description}
            </p>
          )}
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto pr-2">
          <div className="space-y-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
