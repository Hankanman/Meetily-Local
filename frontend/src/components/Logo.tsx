import React from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface LogoProps {
  isCollapsed: boolean;
}

const Logo = React.forwardRef<HTMLButtonElement, LogoProps>(
  ({ isCollapsed }, ref) => {
    return (
      <Dialog aria-describedby={undefined}>
        {isCollapsed ? (
          <DialogTrigger asChild>
            <button
              ref={ref}
              aria-label="About Parley"
              className="
                mb-2 flex cursor-pointer items-center justify-start border-none
                bg-transparent p-0 transition-opacity
                hover:opacity-80
              "
            >
              <Image
                src="/parley-mark.svg"
                alt="Parley"
                width={30}
                height={30}
                priority
                className="rounded-lg"
              />
            </button>
          </DialogTrigger>
        ) : (
          <DialogTrigger asChild>
            <button
              aria-label="About Parley"
              className="
                mb-2 flex cursor-pointer items-center bg-transparent p-0
                transition-opacity
                hover:opacity-80
              "
            >
              <Image
                src="/parley-logo-dark.svg"
                alt="Parley"
                width={99}
                height={26}
                priority
              />
            </button>
          </DialogTrigger>
        )}
        <DialogContent>
          <VisuallyHidden>
            <DialogTitle>About Parley</DialogTitle>
          </VisuallyHidden>
          <About />
        </DialogContent>
      </Dialog>
    );
  },
);

Logo.displayName = "Logo";

export default Logo;
