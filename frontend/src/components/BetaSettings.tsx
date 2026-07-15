"use client";

import { Switch } from "./ui/switch";
import { FlaskConical, AlertCircle } from "lucide-react";
import { Heading } from "@/components/ui/typography";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useConfig } from "@/contexts/ConfigContext";
import {
  BetaFeatureKey,
  BETA_FEATURE_NAMES,
  BETA_FEATURE_DESCRIPTIONS,
} from "@/types/betaFeatures";

export function BetaSettings() {
  const { betaFeatures, toggleBetaFeature } = useConfig();

  // Define feature order for display (allows custom ordering)
  const featureOrder: BetaFeatureKey[] = ["importAndRetranscribe"];

  return (
    <div className="space-y-6">
      {/* Yellow Warning Banner */}
      <Alert variant="warning">
        <AlertCircle className="size-5" />
        <AlertTitle>Beta Features</AlertTitle>
        <AlertDescription>
          These features are still being tested. You may encounter issues, and
          we appreciate your feedback.
        </AlertDescription>
      </Alert>

      {/* Dynamic Feature Toggles - Automatically renders all features */}
      {featureOrder.map((featureKey) => (
        <div
          key={featureKey}
          className="
            rounded-lg border border-border bg-card p-5 shadow-sm
          "
        >
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-2">
                <FlaskConical className="size-5 text-muted-foreground" />
                <Heading level={3}>
                  {BETA_FEATURE_NAMES[featureKey]}
                </Heading>
                <span className="
                  rounded-full bg-warning-muted px-2 py-0.5 text-sm font-medium
                  text-warning
                ">
                  BETA
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {BETA_FEATURE_DESCRIPTIONS[featureKey]}
              </p>
            </div>

            <div className="ml-6">
              <Switch
                checked={betaFeatures[featureKey]}
                onCheckedChange={(checked) =>
                  toggleBetaFeature(featureKey, checked)
                }
              />
            </div>
          </div>
        </div>
      ))}

      {/* Info Box */}
      <Alert variant="info">
        <AlertDescription>
          <strong>Note:</strong> When disabled, beta features will be hidden.
          Your existing meetings remain unaffected.
        </AlertDescription>
      </Alert>
    </div>
  );
}
