"use client";

import React, { useState, useLayoutEffect, useRef } from "react";
import { Button } from "./ui/button";
import { AlertTriangle, CheckCircle, X } from "lucide-react";

interface ComplianceNotificationProps {
  isOpen: boolean;
  onClose: () => void;
  onAcknowledge: () => void;
  recordingButtonRef?: React.RefObject<HTMLElement | HTMLButtonElement | null>;
}

export const ComplianceNotification: React.FC<ComplianceNotificationProps> = ({
  isOpen,
  onClose,
  onAcknowledge,
  recordingButtonRef,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 192 }); // Default width

  // useLayoutEffect so the DOM measurement + initial position are committed
  // before the browser paints the entrance animation. Both setStates are
  // genuinely required here: `isVisible` triggers the CSS transition (which
  // can't happen until *after* the element mounts), and `position` depends
  // on a DOM `getBoundingClientRect()` measurement that isn't available at
  // render time.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (isOpen) {
      setIsVisible(true);

      // Calculate position relative to recording button
      if (recordingButtonRef?.current) {
        const buttonRect = recordingButtonRef.current.getBoundingClientRect();
        const buttonWidth = buttonRect.width;
        const notificationWidth = buttonWidth * 1.5; // 1.5x the button width

        setPosition({
          top: buttonRect.top - 100, // 100px above the button
          left: buttonRect.left + (buttonWidth - notificationWidth) / 2, // Center the notification relative to button
          width: notificationWidth,
        });
      } else {
        // Fallback position if no button ref
        setPosition({
          top: window.innerHeight - 200, // Near bottom of screen
          left: window.innerWidth - 250, // Near right edge
          width: 192, // Default width
        });
      }
    }
  }, [isOpen, recordingButtonRef]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 200);
  };

  const handleAcknowledge = () => {
    onAcknowledge();
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className={`
        fixed z-50 transition-all duration-300
        ${
        isVisible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      }
      `}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: `${position.width}px`,
      }}
    >
      <div className="
        rounded-lg border border-border bg-background p-3 shadow-lg
      ">
        {/* Header with close button */}
        <div className="mb-2 flex items-start justify-between">
          <div className="flex items-center gap-1">
            <AlertTriangle className="size-3 shrink-0 text-amber-500" />
            <h3 className="text-xs font-semibold text-foreground">
              Recording Notice
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="
              rounded-sm p-0.5 text-muted-foreground/70 transition-colors
              hover:bg-muted hover:text-muted-foreground
            "
          >
            <X className="size-3" />
          </button>
        </div>

        {/* Content */}
        <div className="mb-2">
          <p className="mb-1 text-xs text-muted-foreground">
            Inform participants about recording.
          </p>
          <div className="rounded-sm border border-amber-200 bg-amber-50 p-1">
            <p className="text-xs font-medium text-amber-800">
              US compliance required
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            className="h-6 flex-1 px-2 py-0.5 text-xs"
          >
            Later
          </Button>
          <Button
            size="sm"
            onClick={handleAcknowledge}
            className="
              h-6 flex-1 bg-green-600 px-2 py-0.5 text-xs
              hover:bg-green-700
            "
          >
            <CheckCircle className="mr-1 size-2" />
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};
