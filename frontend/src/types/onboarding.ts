export interface OnboardingContainerProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  step?: number;
  totalSteps?: number;
  stepOffset?: number;
  hideProgress?: boolean;
  className?: string;
  showNavigation?: boolean;
  onNext?: () => void;
  onPrevious?: () => void;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
}

export interface StatusIndicatorProps {
  status: "idle" | "checking" | "success" | "error";
  size?: "sm" | "md" | "lg";
}
