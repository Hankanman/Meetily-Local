"use client";

import { Switch } from "./ui/switch";
import { FlaskConical, AlertCircle } from "lucide-react";
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
      <div className="
        flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50
        p-4
      ">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-yellow-600" />
        <div className="text-sm text-yellow-800">
          <p className="font-medium">Beta Features</p>
          <p className="mt-1">
            These features are still being tested. You may encounter issues, and
            we appreciate your feedback.
          </p>
        </div>
      </div>

      {/* Dynamic Feature Toggles - Automatically renders all features */}
      {featureOrder.map((featureKey) => (
        <div
          key={featureKey}
          className="
            rounded-lg border border-border bg-background p-6 shadow-sm
          "
        >
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-2">
                <FlaskConical className="size-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold text-foreground">
                  {BETA_FEATURE_NAMES[featureKey]}
                </h3>
                <span className="
                  rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium
                  text-yellow-800
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
      <div className="rounded-lg border border-blue-500/30 bg-blue-600/10 p-4">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> When disabled, beta features will be hidden.
          Your existing meetings remain unaffected.
        </p>
      </div>
    </div>
  );
}
