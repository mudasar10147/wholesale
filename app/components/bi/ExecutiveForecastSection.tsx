"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import {
  formatPercent,
  formatPkr,
  formatPkrCompactWhole,
} from "@/lib/bi/format";
import { SCENARIO_LABELS } from "@/lib/bi/forecast";
import {
  BiSection,
  ConfidenceBadge,
  DataNote,
  MetricGrid,
  MetricTile,
  StatusPill,
} from "@/app/components/bi/BiPrimitives";

export function ExecutiveForecastSection({ report }: { report: BusinessIntelligenceReport }) {
  const { executive, forecasts, period } = report;
  const confidence = forecasts.revenue.confidence;

  const capacityShort = executive.purchasingShortfall > 0;

  return (
    <BiSection
      id="executive-forecast"
      title="Executive forecast"
      description={`Where next month lands if the current trajectory holds. Projections use the ${SCENARIO_LABELS[report.scenario].toLowerCase()} scenario, fitted on completed calendar months.`}
      action={
        <ConfidenceBadge
          level={confidence.level}
          label={confidence.label}
          reasons={confidence.reasons}
        />
      }
    >
      <div className="rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <p className="text-sm leading-relaxed text-foreground">{executive.sentence}</p>
        <DataNote className="mt-2">
          Month to date, {formatPkr(executive.currentMonthToDateRevenue)} has been billed over{" "}
          {executive.currentMonthDaysElapsed} of {executive.currentMonthDaysTotal} days. Comparisons
          below use the full-month pace that implies, so a part month is never compared against a
          whole one.
        </DataNote>
      </div>

      <MetricGrid columns={4}>
        <MetricTile
          emphasis
          label="Expected revenue"
          value={formatPkrCompactWhole(executive.revenue.forecast)}
          delta={executive.revenue.change}
          deltaPct={executive.revenue.changePct}
          hint={`This month at current pace: ${formatPkrCompactWhole(executive.revenue.current)}`}
        />
        <MetricTile
          emphasis
          label="Expected gross profit"
          value={formatPkrCompactWhole(executive.grossProfit.forecast)}
          delta={executive.grossProfit.change}
          deltaPct={executive.grossProfit.changePct}
          hint={`This month at current pace: ${formatPkrCompactWhole(executive.grossProfit.current)}`}
          info="gross_profit"
        />
        <MetricTile
          emphasis
          label="Expected net profit"
          value={formatPkrCompactWhole(executive.netProfit.forecast)}
          delta={executive.netProfit.change}
          deltaPct={executive.netProfit.changePct}
          tone={executive.netProfit.forecast >= 0 ? "neutral" : "danger"}
          hint={`Gross profit less running costs. This month at current pace: ${formatPkrCompactWhole(executive.netProfit.current)}`}
          info="net_profit"
        />
        <MetricTile
          emphasis
          label="Expected expenses"
          value={formatPkrCompactWhole(executive.expenses.forecast)}
          delta={executive.expenses.change}
          deltaPct={executive.expenses.changePct}
          hint={
            <>
              Fixed {formatPkrCompactWhole(executive.fixedExpenseForecast)} · Variable{" "}
              {formatPkrCompactWhole(executive.variableExpenseForecast)} · Unclassified{" "}
              {formatPkrCompactWhole(executive.unclassifiedExpenseForecast)}
            </>
          }
          info="expense_ratio"
        />
      </MetricGrid>

      <MetricGrid columns={3}>
        <MetricTile
          label="Expected revenue growth"
          value={formatPercent(executive.revenue.changePct)}
          hint={`${formatPkrCompactWhole(executive.revenue.current)} → ${formatPkrCompactWhole(executive.revenue.forecast)} per month`}
          tone={
            executive.revenue.changePct === null
              ? "neutral"
              : executive.revenue.changePct >= 0
                ? "positive"
                : "danger"
          }
        />
        <MetricTile
          label="Expected profit growth"
          value={formatPercent(executive.netProfit.changePct)}
          hint={`${formatPkrCompactWhole(executive.netProfit.current)} → ${formatPkrCompactWhole(executive.netProfit.forecast)} per month`}
          tone={
            executive.netProfit.changePct === null
              ? "neutral"
              : executive.netProfit.changePct >= 0
                ? "positive"
                : "danger"
          }
        />
        <MetricTile
          label="Inventory purchasing capacity"
          value={formatPkrCompactWhole(executive.purchasingCapacity)}
          tone={capacityShort ? "warning" : "positive"}
          info="purchasing_capacity"
          hint={
            <>
              <span className="block">
                Cash in hand plus expected collections, less next month&apos;s running costs.
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <StatusPill tone={capacityShort ? "warning" : "positive"}>
                  {capacityShort
                    ? `Short by ${formatPkrCompactWhole(executive.purchasingShortfall)}`
                    : "Covers the forecast"}
                </StatusPill>
                <span>
                  Needed to sustain the forecast:{" "}
                  {formatPkrCompactWhole(executive.purchasingRequirement)}
                </span>
              </span>
            </>
          }
        />
      </MetricGrid>

      <DataNote>
        Analysis period: {period.label} ({period.description}). Revenue projections respect both the
        sales trend and what your capital can carry — whichever is lower — so extra stock is never
        assumed to sell itself.
      </DataNote>
    </BiSection>
  );
}
