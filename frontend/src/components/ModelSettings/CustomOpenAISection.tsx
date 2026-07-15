import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RefreshCw,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface CustomOpenAISectionProps {
  customOpenAIEndpoint: string;
  setCustomOpenAIEndpoint: (value: string) => void;
  customOpenAIModel: string;
  setCustomOpenAIModel: (value: string) => void;
  customOpenAIApiKey: string;
  setCustomOpenAIApiKey: (value: string) => void;
  customMaxTokens: string;
  setCustomMaxTokens: (value: string) => void;
  customTemperature: string;
  setCustomTemperature: (value: string) => void;
  customTopP: string;
  setCustomTopP: (value: string) => void;
  isAdvancedOpen: boolean;
  setIsAdvancedOpen: (open: boolean) => void;
  isTestingConnection: boolean;
  onTestConnection: () => void;
}

// Custom OpenAI-compatible server configuration: endpoint/model/key inputs,
// a collapsible "Advanced Options" panel, and a test-connection action.
export function CustomOpenAISection({
  customOpenAIEndpoint,
  setCustomOpenAIEndpoint,
  customOpenAIModel,
  setCustomOpenAIModel,
  customOpenAIApiKey,
  setCustomOpenAIApiKey,
  customMaxTokens,
  setCustomMaxTokens,
  customTemperature,
  setCustomTemperature,
  customTopP,
  setCustomTopP,
  isAdvancedOpen,
  setIsAdvancedOpen,
  isTestingConnection,
  onTestConnection,
}: CustomOpenAISectionProps) {
  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <Label htmlFor="custom-endpoint">Endpoint URL *</Label>
        <Input
          id="custom-endpoint"
          value={customOpenAIEndpoint}
          onChange={(e) => setCustomOpenAIEndpoint(e.target.value)}
          placeholder="http://localhost:8000/v1"
          className="mt-1"
        />
        <p className="mt-1 text-sm text-muted-foreground">
          Base URL of the OpenAI-compatible API
        </p>
      </div>

      <div>
        <Label htmlFor="custom-model">Model Name *</Label>
        <Input
          id="custom-model"
          value={customOpenAIModel}
          onChange={(e) => setCustomOpenAIModel(e.target.value)}
          placeholder="gpt-4, llama-3-70b, etc."
          className="mt-1"
        />
        <p className="mt-1 text-sm text-muted-foreground">
          Model identifier to use for requests
        </p>
      </div>

      <div>
        <Label htmlFor="custom-api-key">API Key (optional)</Label>
        <Input
          id="custom-api-key"
          type="password"
          value={customOpenAIApiKey}
          onChange={(e) => setCustomOpenAIApiKey(e.target.value)}
          placeholder="Leave empty if not required"
          className="mt-1"
        />
      </div>

      {/* Advanced Options (Collapsible) */}
      <div>
        <div
          className="flex cursor-pointer items-center justify-between py-2"
          onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
        >
          <Label className="cursor-pointer">Advanced Options</Label>
          {isAdvancedOpen ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </div>

        {isAdvancedOpen && (
          <div className="mt-2 space-y-3 border-l-2 border-muted pl-2">
            <div>
              <Label htmlFor="custom-max-tokens">Max Tokens</Label>
              <Input
                id="custom-max-tokens"
                type="number"
                value={customMaxTokens}
                onChange={(e) => setCustomMaxTokens(e.target.value)}
                placeholder="e.g., 4096"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="custom-temperature">
                Temperature (0.0-2.0)
              </Label>
              <Input
                id="custom-temperature"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={customTemperature}
                onChange={(e) => setCustomTemperature(e.target.value)}
                placeholder="e.g., 0.7"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="custom-top-p">Top P (0.0-1.0)</Label>
              <Input
                id="custom-top-p"
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={customTopP}
                onChange={(e) => setCustomTopP(e.target.value)}
                placeholder="e.g., 0.9"
                className="mt-1"
              />
            </div>
          </div>
        )}
      </div>

      {/* Test Connection Button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onTestConnection}
        disabled={
          isTestingConnection ||
          !customOpenAIEndpoint.trim() ||
          !customOpenAIModel.trim()
        }
        className="w-full"
      >
        {isTestingConnection ? (
          <>
            <RefreshCw className="mr-2 size-4 animate-spin" />
            Testing Connection...
          </>
        ) : (
          <>
            <CheckCircle2 className="mr-2 size-4" />
            Test Connection
          </>
        )}
      </Button>
    </div>
  );
}
