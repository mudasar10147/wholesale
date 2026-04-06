import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type InlineAlertVariant = "error" | "success" | "info";

const variantClasses: Record<InlineAlertVariant, string> = {
  error: "border-destructive/30 bg-destructive-muted text-destructive",
  success: "border-success/30 bg-success-muted text-success",
  info: "border-border bg-surface-muted text-muted-foreground",
};

type InlineAlertProps = {
  variant: InlineAlertVariant;
  children: ReactNode;
  id?: string;
  className?: string;
};

export function InlineAlert({ variant, children, id, className }: InlineAlertProps) {
  return (
    <div
      id={id}
      role={variant === "error" ? "alert" : variant === "success" ? "status" : undefined}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm leading-relaxed",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}
