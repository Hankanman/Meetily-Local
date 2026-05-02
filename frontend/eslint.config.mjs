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
