import "./globals.css";
import "sonner/dist/styles.css";
import type { Metadata } from "next";
import { Source_Sans_3, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import RootLayoutClient from "./RootLayoutClient";

// Parley type system — all self-hosted at build time by next/font (no runtime
// Google fetch, so the app stays fully offline-capable). Source Sans 3 = UI/body,
// Space Grotesk = display/headings/wordmark, JetBrains Mono = timestamps + code.
// The CSS variables are consumed by --font-sans/--font-display/--font-mono in
// globals.css and the Tailwind `fontFamily` config.
const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-source-sans-3",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Parley",
  description: "AI-powered meeting assistant — runs entirely on your machine.",
};

// Server component: owns the document shell (<html>, <body>) and exports
// metadata. All dynamic providers, bridges, and UI live in
// RootLayoutClient. This split is what lets `export const metadata` work
// alongside our client-side providers.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${sourceSans3.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable} font-sans antialiased`}
      >
        <RootLayoutClient>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
