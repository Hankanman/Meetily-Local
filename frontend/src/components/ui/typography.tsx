import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Typography primitives — the single source of truth for headings and text.
 *
 * Sizes map to the `fontSize` scale in `tailwind.config.ts` (`text-h1`,
 * `text-h2`, `text-h3`, `text-body`, `text-small`, `text-caption`), each of
 * which bakes in line-height and weight. Use these instead of hand-rolled
 * `text-lg font-semibold` combos so hierarchy stays consistent app-wide and
 * can be re-tuned in one place.
 */

const headingVariants = cva("text-foreground tracking-tight", {
  variants: {
    // Visual size. Independent of the rendered tag — pass `as` to set the
    // semantic element when it should differ (e.g. a level-2-looking heading
    // that is semantically an <h1>).
    level: {
      1: "text-h1", // page / screen titles
      2: "text-h2", // section headings
      3: "text-h3", // card / sub-section titles
    },
  },
  defaultVariants: {
    level: 2,
  },
});

type HeadingElement = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export interface HeadingProps
  extends
    Omit<React.HTMLAttributes<HTMLHeadingElement>, "color">,
    VariantProps<typeof headingVariants> {
  /** Semantic tag override. Defaults to `h{level}`. */
  as?: HeadingElement;
}

const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, level, as, ...props }, ref) => {
    const Tag = (as ?? `h${level ?? 2}`) as HeadingElement;
    return (
      <Tag
        ref={ref}
        className={cn(headingVariants({ level }), className)}
        {...props}
      />
    );
  },
);
Heading.displayName = "Heading";

const textVariants = cva("", {
  variants: {
    size: {
      body: "text-body",
      small: "text-small",
      caption: "text-caption",
    },
    tone: {
      default: "text-foreground",
      muted: "text-muted-foreground",
      destructive: "text-destructive",
    },
  },
  defaultVariants: {
    // The app is dense; 14px is its default UI text size, not 16px.
    size: "small",
    tone: "default",
  },
});

export interface TextProps
  extends
    Omit<React.HTMLAttributes<HTMLParagraphElement>, "color">,
    VariantProps<typeof textVariants> {
  /** Render as a different element (default `p`). Use `asChild` to merge onto
   *  an arbitrary child instead. */
  as?: "p" | "span" | "div";
  asChild?: boolean;
}

const Text = React.forwardRef<HTMLParagraphElement, TextProps>(
  ({ className, size, tone, as = "p", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : as;
    return (
      <Comp
        ref={ref}
        className={cn(textVariants({ size, tone }), className)}
        {...props}
      />
    );
  },
);
Text.displayName = "Text";

export { Heading, Text, headingVariants, textVariants };
