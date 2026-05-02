import React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
        "flex items-center justify-between rounded-lg border px-6 py-5",
        "transition-all duration-200",
        isAuthorized
          ? "border-foreground bg-muted"
          : isDenied
            ? "border-destructive/30 bg-destructive/10"
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
                ? "bg-destructive/10"
                : "bg-neutral-50",
          )}
        >
          <div
            className={cn(
              isAuthorized
                ? "text-foreground"
                : isDenied
                  ? "text-destructive"
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
              <span className="flex items-center gap-1 text-success">
                <CheckCircle2 className="size-3" />
                Access Granted
              </span>
            ) : isDenied ? (
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="size-3" />
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
            {isChecking && <Spinner size="sm" className="mr-2" />}
            {getButtonText()}
          </Button>
        )}
        {isAuthorized && (
          <div className="
            flex size-8 items-center justify-center rounded-full bg-success-muted
          ">
            <CheckCircle2 className="size-4 text-success" />
          </div>
        )}
      </div>
    </div>
  );
}
