import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import Image from "next/image";
import AnalyticsConsentSwitch from "./AnalyticsConsentSwitch";

export function About() {
  const [currentVersion, setCurrentVersion] = useState<string>("0.3.0");

  useEffect(() => {
    // Get current version on mount
    getVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  const handleContactClick = async () => {
    try {
      await invoke("open_external_url", {
        url: "https://meetily.zackriya.com/#about",
      });
    } catch (error) {
      console.error("Failed to open link:", error);
    }
  };

  return (
    <div className="h-[80vh] space-y-4 overflow-y-auto p-4">
      {/* Compact Header */}
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
        {/* <h1 className="text-xl font-bold text-foreground">Meetily</h1> */}
        <span className="text-sm text-muted-foreground">
          {" "}
          v{currentVersion}
        </span>
        <p className="text-medium mt-1 text-muted-foreground">
          Real-time notes and summaries that never leave your machine.
        </p>
      </div>

      {/* Features Grid - Compact */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">
          What makes Meetily different
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="
            rounded-sm bg-muted p-3 transition-colors
            hover:bg-muted
          ">
            <h3 className="mb-1 text-sm font-bold text-foreground">
              Privacy-first
            </h3>
            <p className="text-xs/relaxed text-muted-foreground">
              Your data & AI processing workflow can now stay within your
              premise. No cloud, no leaks.
            </p>
          </div>
          <div className="
            rounded-sm bg-muted p-3 transition-colors
            hover:bg-muted
          ">
            <h3 className="mb-1 text-sm font-bold text-foreground">
              Use Any Model
            </h3>
            <p className="text-xs/relaxed text-muted-foreground">
              Prefer local open-source model? Great. Want to plug in an external
              API? Also fine. No lock-in.
            </p>
          </div>
          <div className="
            rounded-sm bg-muted p-3 transition-colors
            hover:bg-muted
          ">
            <h3 className="mb-1 text-sm font-bold text-foreground">
              Cost-Smart
            </h3>
            <p className="text-xs/relaxed text-muted-foreground">
              Avoid pay-per-minute bills by running models locally (or pay only
              for the calls you choose).
            </p>
          </div>
          <div className="
            rounded-sm bg-muted p-3 transition-colors
            hover:bg-muted
          ">
            <h3 className="mb-1 text-sm font-bold text-foreground">
              Works everywhere
            </h3>
            <p className="text-xs/relaxed text-muted-foreground">
              Google Meet, Zoom, Teams-online or offline.
            </p>
          </div>
        </div>
      </div>

      {/* Coming Soon - Compact */}
      <div className="rounded-sm bg-blue-600/10 p-3">
        <p className="text-s text-blue-800">
          <span className="font-bold">Coming soon:</span> A library of on-device
          AI agents-automating follow-ups, action tracking, and more.
        </p>
      </div>

      {/* CTA Section - Compact */}
      <div className="space-y-2 text-center">
        <h3 className="text-medium font-semibold text-foreground">
          Ready to push your business further?
        </h3>
        <p className="text-s text-muted-foreground">
          If you&apos;re planning to build privacy-first custom AI agents or a fully
          tailored product for your <span className="font-bold">business</span>,
          we can help you build it.
        </p>
        <button
          onClick={handleContactClick}
          className="
            inline-flex items-center rounded-sm bg-blue-600 px-4 py-2 text-sm
            font-medium text-white shadow-sm transition-colors duration-200
            hover:bg-blue-700 hover:shadow-md
          "
        >
          Chat with the Zackriya team
        </button>
      </div>

      {/* Footer - Compact */}
      <div className="border-t border-border pt-2 text-center">
        <p className="text-xs text-muted-foreground/70">
          Built by Zackriya Solutions
        </p>
      </div>
      <AnalyticsConsentSwitch />
    </div>
  );
}
