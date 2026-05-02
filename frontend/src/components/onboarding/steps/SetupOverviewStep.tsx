import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingContainer } from "../OnboardingContainer";
import { useOnboarding } from "@/contexts/OnboardingContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SetupOverviewStep() {
  const { goNext } = useOnboarding();
  const [recommendedModel, setRecommendedModel] = useState<string>("gemma3:1b");
  const [modelSize, setModelSize] = useState<string>("~806 MB");
  const [isMac, setIsMac] = useState(false);

  // Fetch recommended model on mount
  useEffect(() => {
    const fetchRecommendedModel = async () => {
      try {
        const model = await invoke<string>("builtin_ai_get_recommended_model");
        setRecommendedModel(model);
        setModelSize(model === "gemma3:4b" ? "~2.5 GB" : "~806 MB");
      } catch (error) {
        console.error("Failed to get recommended model:", error);
        // Keep default gemma3:1b
      }
    };
    fetchRecommendedModel();

    // Detect platform for totalSteps
    const checkPlatform = async () => {
      try {
        const { platform } = await import("@tauri-apps/plugin-os");
        setIsMac(platform() === "macos");
      } catch (e) {
        setIsMac(navigator.userAgent.includes("Mac"));
      }
    };
    checkPlatform();
  }, []);

  const steps = [
    {
      number: 1,
      type: "transcription",
      title: "Download Transcription Engine",
    },
    {
      number: 2,
      type: "summarization",
      title: "Download Summarization Engine",
    },
  ];

  const handleContinue = () => {
    goNext();
  };

  return (
    <OnboardingContainer
      title="Setup Overview"
      description="Meetily requires that you download the Transcription & Summarization AI models for the software to work."
      step={2}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="flex flex-col items-center space-y-10">
        {/* Steps Card */}
        <div className="
          w-full max-w-md rounded-lg border border-border bg-background p-4
        ">
          <div className="space-y-4">
            {steps.map((step, idx) => {
              return (
                <div key={step.number} className={`flex items-start gap-4 p-1`}>
                  <div className="ml-1 flex-1">
                    <h3 className="
                      flex items-center gap-2 font-medium text-foreground
                    ">
                      Step {step.number} : {step.title}
                      {step.type === "summarization" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="
                                text-muted-foreground/70
                                hover:text-muted-foreground
                              ">
                                <Info className="size-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-sm">
                              You can also select external AI providers like
                              OpenAI, Claude, or Ollama for summary generation
                              in settings.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </h3>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CTA Section */}
        <div className="w-full max-w-xs space-y-4">
          <Button
            onClick={handleContinue}
            className="
              h-11 w-full bg-gray-900 text-white
              hover:bg-gray-800
            "
          >
            Let&apos;s Go
          </Button>
          <div className="text-center">
            <a
              href="https://github.com/Hankanman/Meetily-Local"
              target="_blank"
              rel="noopener noreferrer"
              className="
                text-xs text-muted-foreground
                hover:underline
              "
            >
              Report issues on GitHub
            </a>
          </div>
        </div>
      </div>
    </OnboardingContainer>
  );
}
