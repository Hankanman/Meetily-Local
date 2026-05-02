import * as React from "react";
import { cn } from "@/lib/utils";

const VisuallyHidden = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      "absolute -m-px size-px overflow-hidden border-0 p-0 whitespace-nowrap",
      "clip-path-inset-50",
      className,
    )}
    style={{
      clipPath: "inset(50%)",
      clip: "rect(0 0 0 0)",
    }}
    {...props}
  />
));
VisuallyHidden.displayName = "VisuallyHidden";

export { VisuallyHidden };
