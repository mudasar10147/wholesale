"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import { formatDays, formatPkr, formatPkrCompactWhole } from "@/lib/bi/format";
import {
  BiCard,
  BiSection,
  DataNote,
  InsufficientData,
  KeyValueRow,
  MetricGrid,
  MetricTile,
  StatusPill,
} from "@/app/components/bi/BiPrimitives";
import { ComparisonBars, chartColor } from "@/app/components/bi/BiCharts";

export function WorkingCapitalSection({ report }: { report: BusinessIntelligenceReport }) {
  const { workingCapital: wc, revenueCapacity, cashCycle } = report;

  const gapKnown = wc.gap !== null;
  const hasSurplus = wc.hasSurplus === true;

  return (
    <BiSection
      id="working-capital"
      title="Working capital"
      description="The money tied up in trading day to day, what the current sales level actually needs, and the revenue that capital can carry."
    >
      <MetricGrid columns={3}>
        <MetricTile
          emphasis
          label="Available working capital"
          value={formatPkrCompactWhole(wc.available)}
          info="working_capital"
          hint={`Liquid portion (cash + receivables): ${formatPkrCompactWhole(wc.liquidCapital)}`}
        />
        <MetricTile
          emphasis
          label="Estimated capital required"
          value={formatPkrCompactWhole(wc.requiredTotal)}
          hint={
            cashCycle.effectiveCycleDays === null
              ? "Needs a measurable cash cycle."
              : `Stock and running costs over a ${cashCycle.effectiveCycleDays.toFixed(0)}-day cash cycle.`
          }
        />
        <MetricTile
          emphasis
          label={gapKnown && hasSurplus ? "Working-capital surplus" : "Working-capital gap"}
          value={gapKnown ? formatPkrCompactWhole(Math.abs(wc.gap ?? 0)) : "—"}
          tone={!gapKnown ? "neutral" : hasSurplus ? "positive" : "danger"}
          hint={
            !gapKnown ? (
              "Not measurable yet."
            ) : (
              <StatusPill tone={hasSurplus ? "positive" : "danger"}>
                {hasSurplus ? "Surplus — capital covers trading" : "Funding gap"}
              </StatusPill>
            )
          }
        />
      </MetricGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <BiCard title="What makes up your working capital" description="Every line is a recorded balance.">
          <div className="space-y-0">
            <KeyValueRow label="Cash on hand" value={formatPkr(wc.cashOnHand)} />
            <KeyValueRow label="Owed by customers" value={formatPkr(wc.accountsReceivable)} />
            <KeyValueRow label="Stock at cost" value={formatPkr(wc.inventoryAtCost)} />
            {wc.loansReceivable > 0 ? (
              <KeyValueRow label="Loans out (owed to you)" value={formatPkr(wc.loansReceivable)} />
            ) : null}
            {wc.loansPayable > 0 ? (
              <KeyValueRow label="Loans owed by you" value={`−${formatPkr(wc.loansPayable)}`} />
            ) : null}
            <KeyValueRow
              label="Owed to suppliers"
              value={<span className="text-muted-foreground">Not tracked</span>}
            />
            <KeyValueRow label="Available working capital" value={formatPkr(wc.available)} emphasize />
          </div>
          <DataNote className="mt-3">
            TradeBridge records no supplier balances, so nothing is subtracted for money owed on
            stock. If you do buy on credit, real working capital is lower than shown here.
          </DataNote>
        </BiCard>

        <BiCard
          title="Available vs required"
          description="Sized from the cash conversion cycle: the longer cash stays tied up, the more of it the same sales need."
        >
          {wc.requiredTotal === null ? (
            <InsufficientData
              metric="Required working capital"
              reason="Needs a measurable cash conversion cycle, which needs recorded stock costs, sales and credit sales in the selected period."
            />
          ) : (
            <>
              <ComparisonBars
                ariaLabel="Available versus required working capital"
                rows={[
                  { label: "Available", value: wc.available, color: chartColor("primary") },
                  {
                    label: "Required",
                    value: wc.requiredTotal,
                    color: hasSurplus ? chartColor("success") : chartColor("destructive"),
                    note: `Stock ${formatPkrCompactWhole(wc.requiredForCurrentSales)} + running costs ${formatPkrCompactWhole(wc.requiredForOperatingCosts)}`,
                  },
                ]}
              />
              <p className="mt-4 text-sm leading-relaxed text-foreground">
                {hasSurplus
                  ? `Capital covers current trading with about ${formatPkr(Math.abs(wc.gap ?? 0))} to spare.`
                  : `Sustaining current trading needs roughly ${formatPkr(Math.abs(wc.gap ?? 0))} more than is available.`}
              </p>
            </>
          )}
        </BiCard>
      </div>

      <BiCard
        title="Revenue capacity"
        description="How much monthly revenue today's capital can realistically carry, given how fast that capital rotates."
      >
        {revenueCapacity.revenueCapacity === null ? (
          <InsufficientData metric="Revenue capacity" reason={revenueCapacity.note} />
        ) : (
          <>
            <MetricGrid columns={3}>
              <MetricTile
                label="Current revenue capacity"
                value={`${formatPkrCompactWhole(revenueCapacity.revenueCapacity)}/month`}
              />
              <MetricTile
                label="With next month's reinvestment"
                value={`${formatPkrCompactWhole(revenueCapacity.revenueCapacityWithReinvestment)}/month`}
              />
              <MetricTile
                label="Headroom over current revenue"
                value={formatPkrCompactWhole(revenueCapacity.headroom)}
                tone={(revenueCapacity.headroom ?? 0) >= 0 ? "positive" : "danger"}
                hint={`Current monthly revenue: ${formatPkrCompactWhole(revenueCapacity.currentMonthlyRevenue)}`}
              />
            </MetricGrid>
            <DataNote className="mt-4">{revenueCapacity.note}</DataNote>
          </>
        )}
      </BiCard>

      <CashCycleCard report={report} />
    </BiSection>
  );
}

function CashCycleCard({ report }: { report: BusinessIntelligenceReport }) {
  const { cashCycle } = report;

  return (
    <BiCard
      title="Cash conversion cycle"
      description="How long a rupee spent on stock stays out of your hands before it comes back as cash."
    >
      <MetricGrid columns={4}>
        <MetricTile
          label="Inventory holding days"
          value={formatDays(cashCycle.inventoryDays)}
          info="inventory_days"
          hint="How long stock sits before it sells."
        />
        <MetricTile
          label="Customer collection days"
          value={formatDays(cashCycle.receivableDays)}
          info="receivable_days"
          hint="How long customers take to pay after being billed."
        />
        <MetricTile
          label="Supplier payment days"
          value={cashCycle.payableDaysTracked ? formatDays(cashCycle.payableDays) : "Not tracked"}
          info="payable_days"
          tone="neutral"
          hint="Supplier balances and terms are not recorded, so this counts as zero."
        />
        <MetricTile
          emphasis
          label="Cash conversion cycle"
          value={formatDays(cashCycle.effectiveCycleDays)}
          info="cash_conversion_cycle"
          tone={
            cashCycle.effectiveCycleDays === null
              ? "neutral"
              : cashCycle.effectiveCycleDays <= 30
                ? "positive"
                : cashCycle.effectiveCycleDays <= 60
                  ? "warning"
                  : "danger"
          }
        />
      </MetricGrid>
      <p className="mt-4 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-foreground">
        {cashCycle.explanation}
      </p>
    </BiCard>
  );
}
