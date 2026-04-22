import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  hint?: ReactNode;
  className?: string;
  /** When set, card is a button (keyboard + screen reader friendly). */
  onClick?: () => void;
  /** Used with `onClick` for accessibility. Defaults to `label`. */
  ariaLabel?: string;
};

export function StatCard({ label, value, hint, className, onClick, ariaLabel }: StatCardProps) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 tabular-nums text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {hint ? <div className="mt-2 text-xs text-muted-foreground">{hint}</div> : null}
    </>
  );

  const shellClass = cn(
    "rounded-xl border border-border bg-surface p-5 shadow-card text-left",
    onClick &&
      "cursor-pointer transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring-offset)]",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={shellClass}
        onClick={onClick}
        aria-label={ariaLabel ?? label}
      >
        {body}
      </button>
    );
  }

  return <div className={shellClass}>{body}</div>;
}
