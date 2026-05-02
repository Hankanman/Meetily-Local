import React from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PermissionRowProps } from "@/types/onboarding";

export function PermissionRow({
  icon,
  title,
  description,
  status,
  isPending = false,
  onAction,
}: PermissionRowProps) {
  const isAuthorized = status === "authorized";
  const isDenied = status === "denied";
  const isChecking = isPending;

  const getButtonText = () => {
    if (isChecking) return "Checking...";
    if (isDenied) return "Open Settings";
    return "Enable";
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-2xl border px-6 py-5",
        "transition-all duration-200",
        isAuthorized
          ? "border-gray-900 bg-muted"
          : isDenied
            ? "border-red-300 bg-red-50"
            : "border-neutral-200 bg-background",
      )}
    >
      {/* Left side: Icon + Info */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Icon */}
        <div
          className={cn(
            `flex size-10 shrink-0 items-center justify-center rounded-full`,
            isAuthorized
              ? "bg-muted"
              : isDenied
                ? "bg-red-100"
                : "bg-neutral-50",
          )}
        >
          <div
            className={cn(
              isAuthorized
                ? "text-foreground"
                : isDenied
                  ? "text-red-500"
                  : "text-neutral-500",
            )}
          >
            {icon}
          </div>
        </div>

        {/* Title + Description */}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-neutral-900">{title}</div>
          <div className="text-sm text-muted-foreground">
            {isAuthorized ? (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="size-3.5" />
                Access Granted
              </span>
            ) : isDenied ? (
              <span className="flex items-center gap-1 text-red-500">
                <XCircle className="size-3.5" />
                Access Denied - Please grant in System Settings
              </span>
            ) : (
              <span>{description}</span>
            )}
          </div>
        </div>
      </div>

      {/* Right side: Action button or checkmark */}
      <div className="ml-3 flex shrink-0 items-center gap-2">
        {!isAuthorized && (
          <Button
            variant={isDenied ? "destructive" : "outline"}
            size="sm"
            onClick={onAction}
            disabled={isChecking}
            className="min-w-25"
          >
            {isChecking && <Loader2 className="mr-2 size-4 animate-spin" />}
            {getButtonText()}
          </Button>
        )}
        {isAuthorized && (
          <div className="
            flex size-8 items-center justify-center rounded-full bg-green-100
          ">
            <CheckCircle2 className="size-4 text-green-600" />
          </div>
        )}
      </div>
    </div>
  );
}
