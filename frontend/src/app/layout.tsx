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
      <head>
        {/* Apply the saved theme before first paint to avoid a light/dark
            flash. Mirrors ThemeContext's resolution; runs synchronously. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('meetily-theme')||'system';var d=t==='dark'||(t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${sourceSans3.variable} font-sans antialiased`}>
        <RootLayoutClient>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
