import nextConfig from "eslint-config-next";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";

// Tailwind v4 entry point — the CSS file with `@import "tailwindcss"`.
// The plugin loads the v4 CSS-based config from this file (instead of a
// `tailwind.config.js`) to know which utilities exist, what the spacing
// scale resolves to, etc.
const TAILWIND_ENTRY = "src/app/globals.css";

const config = [
  ...nextConfig,
  // Apply Tailwind rules only to TS/TSX (where our class strings live).
  // We deliberately don't extend `recommended` — its defaults include
  // formatting opinions (line-wrapping, class ordering) that produce
  // hundreds of warnings on shadcn-generated UI components without
  // adding signal. Cherry-pick the rules that match what the editor's
  // Tailwind LSP surfaces (correctness + v4 migration hints).
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": {
        entryPoint: TAILWIND_ENTRY,
        // Root font size in px. Required for the canonical-classes rule
        // to know that `min-w-[160px]` collapses to `min-w-40` (160 / 4).
        rootFontSize: 16,
      },
    },
    rules: {
      // Suggest `min-h-96` over `min-h-[24rem]` etc. when there's a
      // named scale value, and `shrink-0` over `flex-shrink-0`.
      "better-tailwindcss/enforce-canonical-classes": "warn",
      // Catch v4 renames like `break-words` → `wrap-break-word`.
      "better-tailwindcss/no-deprecated-classes": "warn",
      // Catch contradicting classes (e.g. `flex` + `block`).
      "better-tailwindcss/no-conflicting-classes": "warn",
      // Catch accidental duplicates within a class string.
      "better-tailwindcss/no-duplicate-classes": "warn",
    },
  },
  {
    // Demote React Compiler / React 19 hooks rules from error → warn.
    // They surface real signal (real bugs *and* memoization hints) but
    // many flag patterns that work correctly today (DOM-measurement
    // effects, forward references the runtime resolves fine, third-party
    // hooks like `useVirtualizer` that aren't compiler-friendly). Keeping
    // them as warnings means they appear in the editor and CI without
    // blocking builds; promote individual rules back to "error" once the
    // codebase has been swept.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      // Keep as errors — these almost always indicate real bugs:
      //   react-hooks/purity            (Date.now/Math.random in render)
      //   react-hooks/incompatible-library (suppressed inline where intended)
      //   react-hooks/exhaustive-deps   (already a warning by default)
    },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "src-tauri/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
];

export default config;
