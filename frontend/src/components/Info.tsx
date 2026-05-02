import React from "react";
import { Info as InfoIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface InfoProps {
  isCollapsed: boolean;
}

const Info = React.forwardRef<HTMLButtonElement, InfoProps>(
  ({ isCollapsed }, ref) => {
    return (
      <Dialog aria-describedby={undefined}>
        <DialogTrigger asChild>
          <button
            ref={ref}
            className={`
              mb-2 flex cursor-pointer items-center justify-center border-none
              transition-colors
              ${
              isCollapsed
                ? `
                  rounded-lg bg-transparent p-2
                  hover:bg-muted
                `
                : `
                  mt-1 w-full rounded-lg bg-muted px-3 py-1.5 text-sm
                  font-medium text-foreground shadow-sm
                  hover:bg-muted
                `
            }
            `}
            title="About Meetily"
          >
            <InfoIcon
              className={`
                text-muted-foreground
                ${isCollapsed ? "size-5" : "size-4"}
              `}
            />
            {!isCollapsed && (
              <span className="ml-2 text-sm text-foreground">About</span>
            )}
          </button>
        </DialogTrigger>
        <DialogContent>
          <VisuallyHidden>
            <DialogTitle>About Meetily</DialogTitle>
          </VisuallyHidden>
          <About />
        </DialogContent>
      </Dialog>
    );
  },
);

Info.displayName = "About";

export default Info;
