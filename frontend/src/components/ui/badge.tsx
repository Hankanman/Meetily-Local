import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Parley Badge — small pill for status / metadata. Ported from the design
// system's `.pl-badge`. The app had no Badge component; "badge-like" chips were
// previously hand-rolled per call-site. Colours track the .dark flip via the
// semantic token families (brand / success / info / warning / destructive).
const badgeVariants = cva(
  `
    inline-flex items-center gap-1.5 rounded-full border border-transparent
    px-2.5 py-1 text-xs font-semibold leading-none whitespace-nowrap
  `,
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-foreground",
        brand: "bg-brand-muted text-brand-strong",
        success: "bg-success-muted text-success",
        info: "bg-info-muted text-info",
        warning: "bg-warning-muted text-warning",
        destructive: "bg-destructive/12 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Render a small leading dot in the current text colour. */
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
