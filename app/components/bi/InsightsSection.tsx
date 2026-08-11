"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import type { InsightTone, RiskOrOpportunity } from "@/lib/bi/insights";
import {
  BiCard,
  BiSection,
  DataNote,
  EmptyState,
  StatusPill,
} from "@/app/components/bi/BiPrimitives";
import { cn } from "@/lib/utils";

const toneStyles: Record<InsightTone, { border: string; glyph: string; label: string }> = {
  positive: { border: "border-l-success", glyph: "▲", label: "Positive" },
  neutral: { border: "border-l-primary", glyph: "•", label: "Note" },
  warning: { border: "border-l-accent", glyph: "!", label: "Watch" },
  danger: { border: "border-l-destructive", glyph: "×", label: "Urgent" },
};

export function GrowthConstraintCard({ report }: { report: BusinessIntelligenceReport }) {
  const { growthConstraint: constraint } = report;
  const unknown = constraint.id === "insufficient_data";

  return (
    <BiCard
      title="Current growth constraint"
      description="The single biggest thing holding growth back right now, chosen by scoring each candidate against recorded evidence."
    >
      <div
        className={cn(
          "rounded-lg border-l-4 bg-surface-muted px-4 py-4",
          unknown ? "border-l-muted" : "border-l-destructive",
        )}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Growth constraint
        </p>
        <p className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {constraint.label}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{constraint.explanation}</p>

        {constraint.evidence.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {constraint.evidence.map((item) => (
              <li key={item}>
                <StatusPill tone="neutral">{item}</StatusPill>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {constraint.alternates.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-foreground">Also close</h4>
          <ul className="mt-1.5 space-y-1.5">
            {constraint.alternates.map((alt) => (
              <li key={alt.id} className="text-sm leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{alt.label}</span> — {alt.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </BiCard>
  );
}

function RiskList({
  items,
  emptyMessage,
  tone,
}: {
  items: readonly RiskOrOpportunity[];
  emptyMessage: string;
  tone: "risk" | "opportunity";
}) {
  if (items.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;

  const severityTone = (severity: RiskOrOpportunity["severity"]) => {
    if (tone === "opportunity") return severity === "high" ? "positive" : "neutral";
    return severity === "high" ? "danger" : severity === "medium" ? "warning" : "neutral";
  };

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "rounded-lg border border-border bg-surface-muted px-4 py-3",
            tone === "risk" ? "border-l-4 border-l-destructive/60" : "border-l-4 border-l-success/60",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{item.title}</p>
            <StatusPill tone={severityTone(item.severity)}>{item.severity}</StatusPill>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function InsightsSection({ report }: { report: BusinessIntelligenceReport }) {
  return (
    <BiSection
      id="insights"
      title="TradeBridge business insights"
      description="Generated from the calculations above by fixed rules — the same data always produces the same insights. No external AI service is involved."
    >
      <GrowthConstraintCard report={report} />

      <BiCard
        title="What the numbers are telling you"
        description="Only statements the recorded data supports."
      >
        {report.insights.length === 0 ? (
          <EmptyState>
            Not enough recorded activity yet to say anything useful. Post invoices, record expenses
            and receive stock for a couple of months and this fills in.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {report.insights.map((insight) => {
              const style = toneStyles[insight.tone];
              return (
                <li
                  key={insight.id}
                  className={cn("rounded-lg border border-border border-l-4 bg-surface-muted px-4 py-3", style.border)}
                >
                  <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-xs font-bold text-muted-foreground"
                    >
                      {style.glyph}
                    </span>
                    <span>
                      <span className="sr-only">{style.label}: </span>
                      {insight.text}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </BiCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <BiCard title="Opportunities" description="Where the next rupee of effort or capital pays best.">
          <RiskList
            items={report.opportunities}
            tone="opportunity"
            emptyMessage="No clear opportunities stand out from the recorded data yet."
          />
        </BiCard>

        <BiCard title="Risks" description="Only risks the data actually supports.">
          <RiskList
            items={report.risks}
            tone="risk"
            emptyMessage="No risks are flagged by the recorded data right now."
          />
        </BiCard>
      </div>

      {report.dataGaps.length > 0 ? (
        <BiCard
          title="What TradeBridge cannot measure yet"
          description="Metrics that need data the system does not currently capture. Nothing here is estimated in silence."
        >
          <ul className="space-y-3">
            {report.dataGaps.map((gap) => (
              <li key={gap.metric} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                <p className="text-sm font-medium text-foreground">{gap.metric}</p>
                <DataNote className="mt-0.5">{gap.reason}</DataNote>
              </li>
            ))}
          </ul>
        </BiCard>
      ) : null}
    </BiSection>
  );
}
