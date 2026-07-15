"use client";

import { motion } from "framer-motion";
import { FileQuestion, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EmptyStateSummaryProps {
  onGenerate: () => void;
  hasModel: boolean;
  isGenerating?: boolean;
}

export function EmptyStateSummary({
  onGenerate,
  hasModel,
  isGenerating = false,
}: EmptyStateSummaryProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="
        flex h-full flex-col items-center justify-center p-8 text-center
      "
    >
      <FileQuestion className="mb-4 size-16 text-muted-foreground/70" />
      <Heading level={2} className="mb-2">
        No Summary Generated Yet
      </Heading>
      <Text size="small" tone="muted" className="mb-6 max-w-md">
        Generate an AI-powered summary of your meeting transcript to get key
        points, action items, and decisions.
      </Text>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Button
                onClick={onGenerate}
                disabled={!hasModel || isGenerating}
                className="gap-2"
              >
                <Sparkles className="size-4" />
                {isGenerating ? "Generating..." : "Generate Summary"}
              </Button>
            </div>
          </TooltipTrigger>
          {!hasModel && (
            <TooltipContent>
              <p>Please select a model in Settings first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      {!hasModel && (
        <p className="mt-3 text-sm text-warning">
          Please select a model in Settings first
        </p>
      )}
    </motion.div>
  );
}
