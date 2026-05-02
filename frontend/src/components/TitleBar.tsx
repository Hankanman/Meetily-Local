"use client";

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";

// Custom title bar — replaces the native window decorations (which on Linux
// GTK are drawn by libdecor and never match the system theme). The drag
// region (`-webkit-app-region: drag`) lets the user move the window;
// individual buttons opt out via `no-drag`. Window controls go through the
// Tauri webview window API; permissions are granted by `core:window:default`
// in tauri.conf.json.
export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    (async () => {
      setIsMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
      });
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  const win = () => getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="
        titlebar flex h-8 shrink-0 select-none items-center justify-between
        border-b border-border bg-background
      "
    >
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center px-3 text-sm text-muted-foreground"
      >
        Meetily
      </div>
      <div className="no-drag flex h-full">
        <TitleBarButton
          ariaLabel="Minimize"
          onClick={() => win().minimize()}
        >
          <Minus className="size-3" />
        </TitleBarButton>
        <TitleBarButton
          ariaLabel={isMaximized ? "Restore" : "Maximize"}
          onClick={() => win().toggleMaximize()}
        >
          {isMaximized ? (
            <Copy className="size-3 -scale-x-100" />
          ) : (
            <Square className="size-3" />
          )}
        </TitleBarButton>
        <TitleBarButton
          ariaLabel="Close"
          onClick={() => win().close()}
          variant="danger"
        >
          <X className="size-3" />
        </TitleBarButton>
      </div>
    </div>
  );
}

function TitleBarButton({
  children,
  onClick,
  ariaLabel,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`
        flex h-full w-11 items-center justify-center text-muted-foreground
        transition-colors
        ${variant === "danger"
          ? "hover:bg-destructive hover:text-white"
          : "hover:bg-muted hover:text-foreground"
        }
      `}
    >
      {children}
    </button>
  );
}
