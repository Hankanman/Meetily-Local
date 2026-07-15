import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface OllamaEndpointConfigProps {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  ollamaEndpoint: string;
  onEndpointChange: (value: string) => void;
  endpointValidationState: "valid" | "invalid" | "none";
  onFetchModels: () => void;
  isLoadingOllama: boolean;
  ollamaEndpointChanged: boolean;
  error: string;
}

// Collapsible "Custom Endpoint" section for the Ollama provider: URL input
// with debounced validation feedback, and a manual "Fetch Models" trigger.
export function OllamaEndpointConfig({
  isCollapsed,
  onToggleCollapsed,
  ollamaEndpoint,
  onEndpointChange,
  endpointValidationState,
  onFetchModels,
  isLoadingOllama,
  ollamaEndpointChanged,
  error,
}: OllamaEndpointConfigProps) {
  return (
    <div>
      <div
        className="flex cursor-pointer items-center justify-between py-2"
        onClick={onToggleCollapsed}
      >
        <Label className="cursor-pointer">Custom Endpoint (optional)</Label>
        {isCollapsed ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="size-4 text-muted-foreground" />
        )}
      </div>

      {!isCollapsed && (
        <>
          <p className="mt-1 mb-2 text-sm text-muted-foreground">
            Leave empty or enter a custom endpoint (e.g.,
            http://x.yy.zz:11434)
          </p>
          <div className="mt-1 flex gap-2">
            <div className="relative flex-1">
              <Input
                type="url"
                value={ollamaEndpoint}
                onChange={(e) => onEndpointChange(e.target.value)}
                placeholder="http://localhost:11434"
                className={cn(
                  "pr-10",
                  endpointValidationState === "invalid" &&
                    "border-destructive/30",
                )}
              />
              {endpointValidationState === "valid" && (
                <CheckCircle2 className="
                  absolute top-1/2 right-3 size-5 -translate-y-1/2
                  text-success
                " />
              )}
              {endpointValidationState === "invalid" && (
                <XCircle className="
                  absolute top-1/2 right-3 size-5 -translate-y-1/2
                  text-destructive
                " />
              )}
            </div>
            <Button
              type="button"
              size={"sm"}
              onClick={onFetchModels}
              disabled={isLoadingOllama}
              variant="outline"
              className="whitespace-nowrap"
            >
              {isLoadingOllama ? (
                <>
                  <RefreshCw className="mr-2 size-4 animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 size-4" />
                  Fetch Models
                </>
              )}
            </Button>
          </div>
          {ollamaEndpointChanged && !error && (
            <Alert className="mt-3 border-warning/30 bg-warning-muted">
              <AlertDescription className="text-warning">
                Endpoint changed. Please click &quot;Fetch Models&quot; to load
                models from the new endpoint before saving.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
