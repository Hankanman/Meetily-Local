import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Unlock, Eye, EyeOff } from "lucide-react";

interface ApiKeyFieldProps {
  apiKey: string | null;
  setApiKey: (value: string) => void;
  showApiKey: boolean;
  setShowApiKey: (value: boolean) => void;
  isApiKeyLocked: boolean;
  setIsApiKeyLocked: (value: boolean) => void;
}

// Generic API key input shared by the cloud providers (Claude/Groq/OpenAI/
// OpenRouter). The "lock to prevent editing" vibration is a purely local
// UI affordance, so its state lives here rather than being drilled in.
export function ApiKeyField({
  apiKey,
  setApiKey,
  showApiKey,
  setShowApiKey,
  isApiKeyLocked,
  setIsApiKeyLocked,
}: ApiKeyFieldProps) {
  const [isLockButtonVibrating, setIsLockButtonVibrating] =
    useState<boolean>(false);

  const handleInputClick = () => {
    if (isApiKeyLocked) {
      setIsLockButtonVibrating(true);
      setTimeout(() => setIsLockButtonVibrating(false), 500);
    }
  };

  return (
    <div>
      <Label>API Key</Label>
      <div className="relative mt-1">
        <Input
          type={showApiKey ? "text" : "password"}
          value={apiKey || ""}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={isApiKeyLocked}
          placeholder="Enter your API key"
          className="pr-24"
        />
        {isApiKeyLocked && apiKey?.trim() && (
          <div
            onClick={handleInputClick}
            className="
              absolute inset-0 flex cursor-not-allowed items-center
              justify-center rounded-md bg-muted/50
            "
          />
        )}
        <div className="
          absolute inset-y-0 right-0 flex items-center space-x-1 pr-1
        ">
          {apiKey?.trim() && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
              className={
                isLockButtonVibrating ? "animate-vibrate text-destructive" : ""
              }
              title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
            >
              {isApiKeyLocked ? <Lock /> : <Unlock />}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowApiKey(!showApiKey)}
          >
            {showApiKey ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>
    </div>
  );
}
