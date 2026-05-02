import React, { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import Image from "next/image";

export function About() {
  const [currentVersion, setCurrentVersion] = useState<string>("0.3.0");

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  return (
    <div className="h-[80vh] space-y-4 overflow-y-auto p-4">
      <div className="text-center">
        <div className="mb-3">
          <Image
            src="icon_128x128.png"
            alt="Meetily Logo"
            width={64}
            height={64}
            className="mx-auto"
          />
        </div>
        <span className="text-sm text-muted-foreground"> v{currentVersion}</span>
        <p className="text-sm mt-1 text-muted-foreground">
          Real-time notes and summaries that never leave your machine.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          What makes Meetily different
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="
            rounded-md bg-muted p-3 transition-colors
            hover:bg-muted
          ">
            <h3 className="mb-1 text-sm font-bold text-foreground">
              Privacy-first
            </h3>
            <p className="text-sm/relaxed text-muted-foreground">
              Your data &amp; AI processing stay on your machine. No cloud, no leaks.
            </p>
          </div>
          <div className="
            rounded-md bg-muted p-3 transition-colors
            hover:bg-muted
          ">
            <h3 className="mb-1 text-sm font-bold text-foreground">
              Use Any Model
            </h3>
            <p className="text-sm/relaxed text-muted-foreground">
              Local open-source models or external APIs — your choice. No lock-in.
            </p>
          </div>
          <div className="
            rounded-md bg-muted p-3 transition-colors
            hover:bg-muted
          ">
            <h3 className="mb-1 text-sm font-bold text-foreground">
              Cost-Smart
            </h3>
            <p className="text-sm/relaxed text-muted-foreground">
              Run models locally for free, or pay only for the calls you choose.
            </p>
          </div>
          <div className="
            rounded-md bg-muted p-3 transition-colors
            hover:bg-muted
          ">
            <h3 className="mb-1 text-sm font-bold text-foreground">
              Works everywhere
            </h3>
            <p className="text-sm/relaxed text-muted-foreground">
              Google Meet, Zoom, Teams — online or offline.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
