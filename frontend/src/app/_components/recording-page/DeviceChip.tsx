"use client";

import { ReactNode, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Option {
  value: string;
  label: string;
  description?: string;
}

interface DeviceChipProps {
  icon: ReactNode;
  /** Short label shown inside the chip — what the chip is currently set to. */
  value: string;
  options: Option[];
  selectedValue: string | null;
  onSelect: (value: string) => void;
  emptyState?: string;
  disabled?: boolean;
}

/**
 * One pill-shaped chip with an icon, the current selection text, and a
 * down-arrow that opens a popover for changing it. Used in DeviceSummary
 * (mic / system / language) on the pre-recording hero.
 */
export function DeviceChip({
  icon,
  value,
  options,
  selectedValue,
  onSelect,
  emptyState,
  disabled = false,
}: DeviceChipProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="
            inline-flex items-center gap-2 rounded-full border border-border
            bg-background px-3 py-1.5 text-sm shadow-sm transition-colors
            hover:bg-muted
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          <span className="text-muted-foreground">{icon}</span>
          <span className="max-w-40 truncate">{value}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-80 w-72 overflow-y-auto p-1"
      >
        {options.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {emptyState ?? "No options available"}
          </p>
        ) : (
          options.map((opt) => {
            const isSelected = opt.value === selectedValue;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
                className={`
                  flex w-full items-start gap-2 rounded-md px-2 py-2 text-left
                  text-sm transition-colors
                  hover:bg-muted
                  ${isSelected ? "bg-muted" : ""}
                `}
              >
                <Check
                  className={`
                    mt-0.5 size-4 shrink-0
                    ${isSelected ? "text-info" : "invisible"}
                  `}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{opt.label}</p>
                  {opt.description && (
                    <p className="truncate text-xs text-muted-foreground">
                      {opt.description}
                    </p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
