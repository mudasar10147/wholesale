"use client";

import { useId, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";
import { formatPercentDelta, formatPkrDelta } from "@/lib/bi/format";
import { glossaryTerm, type GlossaryTermId } from "@/lib/bi/glossary";
import type { ConfidenceLevel } from "@/lib/bi/forecast";

/* ── Section shell ────────────────────────────────────────────────────── */

export function BiSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="space-y-4 scroll-mt-24">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function BiCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className={action ? "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" : undefined}>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/* ── Metric tile ──────────────────────────────────────────────────────── */

export type MetricTone = "neutral" | "positive" | "warning" | "danger";

const toneValueClass: Record<MetricTone, string> = {
  neutral: "text-foreground",
  positive: "text-success",
  warning: "text-accent-foreground",
  danger: "text-destructive",
};

export function MetricTile({
  label,
  value,
  hint,
  delta,
  deltaPct,
  tone = "neutral",
  info,
  emphasis,
  className,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  /** Absolute change, rendered as money. */
  delta?: number | null;
  /** Percentage change. */
  deltaPct?: number | null;
  tone?: MetricTone;
  info?: GlossaryTermId;
  /** Larger type for the headline cards. */
  emphasis?: boolean;
  className?: string;
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const hasDeltaPct = typeof deltaPct === "number" && Number.isFinite(deltaPct);
  const direction = hasDelta ? Math.sign(delta) : hasDeltaPct ? Math.sign(deltaPct) : 0;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {info ? <InfoTip term={info} /> : null}
      </div>
      <p
        className={cn(
          "mt-2 break-words tabular-nums font-semibold tracking-tight",
          emphasis ? "text-2xl sm:text-[1.75rem]" : "text-xl sm:text-2xl",
          toneValueClass[tone],
        )}
      >
        {value}
      </p>
      {hasDelta || hasDeltaPct ? (
        <p
          className={cn(
            "mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium tabular-nums",
            direction > 0 ? "text-success" : direction < 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <span aria-hidden="true">{direction > 0 ? "▲" : direction < 0 ? "▼" : "—"}</span>
          {hasDelta ? <span>{formatPkrDelta(delta)}</span> : null}
          {hasDeltaPct ? <span>({formatPercentDelta(deltaPct)})</span> : null}
        </p>
      ) : null}
      {hint ? <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function MetricGrid({
  children,
  columns = 4,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
}) {
  const cls =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";
  return <div className={cn("grid gap-4", cls)}>{children}</div>;
}

/* ── Confidence badge ─────────────────────────────────────────────────── */

const confidenceClass: Record<ConfidenceLevel, string> = {
  high: "border-success/30 bg-success-muted text-success",
  medium: "border-accent/40 bg-accent-muted text-accent-foreground",
  low: "border-destructive/30 bg-destructive-muted text-destructive",
  insufficient: "border-border bg-surface-muted text-muted-foreground",
};

const confidenceIcon: Record<ConfidenceLevel, string> = {
  high: "●●●",
  medium: "●●○",
  low: "●○○",
  insufficient: "○○○",
};

export function ConfidenceBadge({
  level,
  label,
  reasons,
}: {
  level: ConfidenceLevel;
  label: string;
  reasons?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const hasReasons = !!reasons && reasons.length > 0;

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
          confidenceClass[level],
          hasReasons &&
            "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring-offset)]",
        )}
        onClick={() => hasReasons && setOpen((v) => !v)}
        aria-expanded={hasReasons ? open : undefined}
        aria-controls={hasReasons ? panelId : undefined}
        disabled={!hasReasons}
      >
        <span aria-hidden="true" className="tracking-tighter">
          {confidenceIcon[level]}
        </span>
        <span>{label}</span>
        {hasReasons ? (
          <span aria-hidden="true" className="text-[0.65rem]">
            {open ? "▲" : "▼"}
          </span>
        ) : null}
      </button>
      {hasReasons && open ? (
        <ul id={panelId} className="max-w-md space-y-1 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── Info tooltip ─────────────────────────────────────────────────────── */

export function InfoTip({ term, className }: { term: GlossaryTermId; className?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const entry = glossaryTerm(term);

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`What is ${entry.title}?`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[0.65rem] font-semibold leading-none text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring-offset)]"
      >
        i
      </button>
      {open ? (
        <span
          id={panelId}
          role="note"
          className="absolute right-0 top-6 z-20 w-64 max-w-[min(16rem,80vw)] rounded-lg border border-border bg-surface p-3 text-left shadow-card"
        >
          <span className="block text-xs font-semibold text-foreground">{entry.title}</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{entry.summary}</span>
          {entry.formula ? (
            <span className="mt-1.5 block rounded bg-surface-muted px-2 py-1 font-mono text-[0.7rem] leading-relaxed text-foreground">
              {entry.formula}
            </span>
          ) : null}
          {entry.why ? (
            <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{entry.why}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/* ── Small building blocks ────────────────────────────────────────────── */

export function DataNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>{children}</p>
  );
}

export function InsufficientData({ metric, reason }: { metric: string; reason: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface-muted px-4 py-3">
      <p className="text-sm font-medium text-foreground">Insufficient data — {metric}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{reason}</p>
    </div>
  );
}

export function KeyValueRow({
  label,
  value,
  emphasize,
  tone = "neutral",
  info,
}: {
  label: ReactNode;
  value: ReactNode;
  emphasize?: boolean;
  tone?: MetricTone;
  info?: GlossaryTermId;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm last:border-b-0",
        emphasize && "border-border-strong",
      )}
    >
      <span className={cn("flex items-center gap-1.5 text-muted-foreground", emphasize && "font-medium text-foreground")}>
        {label}
        {info ? <InfoTip term={info} /> : null}
      </span>
      <span
        className={cn(
          "shrink-0 tabular-nums text-foreground",
          emphasize && "text-base font-semibold",
          toneValueClass[tone],
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Table wrapper: scrolls horizontally only when the content genuinely needs it. */
export function ScrollTable({
  children,
  minWidth = 640,
  label,
}: {
  children: ReactNode;
  minWidth?: number;
  label?: string;
}) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0" role="region" aria-label={label} tabIndex={0}>
      <div className="px-4 sm:px-0">
        <table
          className="w-full border-collapse text-left text-sm"
          style={{ minWidth: `${minWidth}px` }}
        >
          {children}
        </table>
      </div>
    </div>
  );
}

export function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-border bg-surface-muted px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        numeric && "text-right",
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-border px-3 py-2.5 text-foreground last:border-b-0",
        numeric && "whitespace-nowrap text-right tabular-nums",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-surface-muted px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function LoadingBlock({ label = "Calculating…" }: { label?: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {label}
    </p>
  );
}

/** Status pill that never relies on colour alone — every variant carries a glyph. */
export function StatusPill({
  tone,
  children,
}: {
  tone: MetricTone;
  children: ReactNode;
}) {
  const classes: Record<MetricTone, string> = {
    neutral: "border-border bg-surface-muted text-muted-foreground",
    positive: "border-success/30 bg-success-muted text-success",
    warning: "border-accent/40 bg-accent-muted text-accent-foreground",
    danger: "border-destructive/30 bg-destructive-muted text-destructive",
  };
  const glyph: Record<MetricTone, string> = {
    neutral: "•",
    positive: "✓",
    warning: "!",
    danger: "×",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        classes[tone],
      )}
    >
      <span aria-hidden="true">{glyph[tone]}</span>
      {children}
    </span>
  );
}
