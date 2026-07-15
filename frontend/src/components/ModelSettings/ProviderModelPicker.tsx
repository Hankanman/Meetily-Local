import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { RefreshCw, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModelConfig } from "./types";

interface ProviderModelPickerProps {
  provider: ModelConfig["provider"];
  model: string;
  modelOptions: Record<string, string[]>;
  onProviderChange: (provider: ModelConfig["provider"]) => void;
  setModelConfig: (
    config: ModelConfig | ((prev: ModelConfig) => ModelConfig),
  ) => void;
  modelComboboxOpen: boolean;
  setModelComboboxOpen: (open: boolean) => void;
  isCloudLoading: boolean;
  showCloudLoading: boolean;
}

// Provider select + model combobox. Kept as a single component since both
// controls live inside the same "Summarization Model" row and the model
// combobox's visibility/options depend directly on the selected provider.
export function ProviderModelPicker({
  provider,
  model,
  modelOptions,
  onProviderChange,
  setModelConfig,
  modelComboboxOpen,
  setModelComboboxOpen,
  isCloudLoading,
  showCloudLoading,
}: ProviderModelPickerProps) {
  return (
    <div className="mt-1 flex space-x-2">
      <Select
        value={provider}
        onValueChange={(value) =>
          onProviderChange(value as ModelConfig["provider"])
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Select provider" />
        </SelectTrigger>
        <SelectContent className="max-h-64 overflow-y-auto">
          <SelectItem value="builtin-ai">
            Built-in AI (Offline, No API needed)
          </SelectItem>
          <SelectItem value="claude">Claude</SelectItem>
          <SelectItem value="custom-openai">Custom Server (OpenAI)</SelectItem>
          <SelectItem value="groq">Groq</SelectItem>
          <SelectItem value="ollama">Ollama</SelectItem>
          <SelectItem value="openai">OpenAI</SelectItem>
          <SelectItem value="openrouter">OpenRouter</SelectItem>
        </SelectContent>
      </Select>

      {provider !== "builtin-ai" && provider !== "custom-openai" && (
        <Popover
          open={modelComboboxOpen}
          onOpenChange={setModelComboboxOpen}
          modal={true}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={modelComboboxOpen}
              className="max-w-50 flex-1 justify-between font-normal"
            >
              <span className="truncate">{model || "Select model..."}</span>
              <ChevronsUpDown className="
                ml-2 size-4 shrink-0 opacity-50
              " />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-62.5 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search models..." />
              <CommandList className="max-h-75">
                {isCloudLoading && showCloudLoading ? (
                  <div className="
                    py-6 text-center text-sm text-muted-foreground
                  ">
                    <RefreshCw className="
                      mx-auto mb-2 size-4 animate-spin
                    " />
                    Loading models...
                  </div>
                ) : isCloudLoading ? null : (
                  <>
                    <CommandEmpty>No models found.</CommandEmpty>
                    <CommandGroup>
                      {modelOptions[provider]?.map((m) => (
                        <CommandItem
                          key={m}
                          value={m}
                          onSelect={(currentValue) => {
                            setModelConfig((prev: ModelConfig) => ({
                              ...prev,
                              model: currentValue,
                            }));
                            setModelComboboxOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 size-4",
                              model === m ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="truncate">{m}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
