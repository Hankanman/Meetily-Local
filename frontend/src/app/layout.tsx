import "./globals.css";
import "sonner/dist/styles.css";
import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import RootLayoutClient from "./RootLayoutClient";

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-source-sans-3",
});

export const metadata: Metadata = {
  title: "Meetily",
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
      <body className={`${sourceSans3.variable} font-sans antialiased`}>
        <RootLayoutClient>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
