import React from "react";
import {
  Check,
  Lock,
  Download,
  CheckCircle2,
  BrainCircuit,
} from "lucide-react";

interface ProgressIndicatorProps {
  current: number;
  total: number;
  onStepClick?: (step: number) => void;
}

const stepIcons = [
  Lock, // 1. Welcome
  BrainCircuit, // 2. Setup Overview
  Download, // 3. Download Progress
  // Step 4 (Permissions) doesn't need icon - auto-skipped on non-macOS
];

export function ProgressIndicator({
  current,
  total,
  onStepClick,
}: ProgressIndicatorProps) {
  const visibleSteps = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-center gap-2">
        {visibleSteps.map((step, index) => {
          const isActive = step === current;
          const isCompleted = step < current;
          const isClickable = isCompleted && onStepClick;
          const StepIcon = stepIcons[step - 1] || CheckCircle2;

          return (
            <React.Fragment key={step}>
              {/* Step Circle */}
              <button
                onClick={() => isClickable && onStepClick(step)}
                disabled={!isClickable}
                className={`
                  relative flex items-center justify-center transition-all
                  duration-300
                  ${
                  isCompleted
                    ? "size-7 rounded-full bg-green-600"
                    : isActive
                      ? "size-8 rounded-full bg-gray-900"
                      : "size-6 rounded-full bg-muted"
                }
                  ${isClickable ? `
                    cursor-pointer
                    hover:scale-110 hover:shadow-md
                  ` : `cursor-default`}
                `}
              >
                {isCompleted ? (
                  <Check className="size-4 text-white" />
                ) : (
                  <StepIcon
                    className={`
                      transition-all duration-300
                      ${
                      isActive
                        ? "size-4 text-white"
                        : "size-3 text-muted-foreground"
                    }
                    `}
                  />
                )}
              </button>

              {/* Connector Line */}
              {index < visibleSteps.length - 1 && (
                <div
                  className={`
                    h-0.5 w-6 transition-all duration-300
                    ${
                    isCompleted ? "bg-green-600" : "bg-muted"
                  }
                  `}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
