import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  `
    relative w-full rounded-lg border px-4 py-3 text-sm
    [&>svg]:absolute [&>svg]:top-4 [&>svg]:left-4 [&>svg]:text-foreground
    [&>svg+div]:-translate-y-0.75
    [&>svg~*]:pl-7
  `,
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        // Semantic status callouts. Tinted background + matching border/text
        // so an inline error/warning/success/info box is one component instead
        // of a hand-rolled `border-destructive/30 bg-destructive/10` div.
        destructive:
          `
            border-destructive/50 bg-destructive/10 text-destructive
            dark:border-destructive
            [&>svg]:text-destructive
          `,
        warning:
          `
            border-warning/50 bg-warning-muted text-warning
            [&>svg]:text-warning
          `,
        success:
          `
            border-success/50 bg-success-muted text-success
            [&>svg]:text-success
          `,
        info:
          `
            border-info/50 bg-info-muted text-info
            [&>svg]:text-info
          `,
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 leading-none font-medium tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(`
      text-sm
      [&_p]:leading-relaxed
    `, className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
