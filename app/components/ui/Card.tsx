import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

type CardSectionProps = {
  children: ReactNode;
  className?: string;
};

export function CardHeader({ children, className }: CardSectionProps) {
  return (
    <div className={cn("border-b border-border px-4 py-4 sm:px-6 sm:py-5", className)}>{children}</div>
  );
}

export function CardTitle({ children, className }: CardSectionProps) {
  return (
    <h2 className={cn("text-base font-semibold tracking-tight text-foreground", className)}>
      {children}
    </h2>
  );
}

export function CardDescription({ children, className }: CardSectionProps) {
  return (
    <p className={cn("mt-1 text-sm leading-relaxed text-muted-foreground", className)}>
      {children}
    </p>
  );
}

export function CardContent({ children, className }: CardSectionProps) {
  return <div className={cn("px-4 py-4 sm:px-6 sm:py-5", className)}>{children}</div>;
}
