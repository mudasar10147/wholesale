"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import { formatPercent, formatPkr, formatPkrCompactWhole, formatTurns } from "@/lib/bi/format";
import {
  BiCard,
  BiSection,
  DataNote,
  KeyValueRow,
  MetricGrid,
  MetricTile,
  ScrollTable,
  StatusPill,
  Td,
  Th,
} from "@/app/components/bi/BiPrimitives";
import { TrendChart, chartColor } from "@/app/components/bi/BiCharts";

const FLOW_STEPS = [
  { label: "Profit", detail: "Earned this month" },
  { label: "Reinvested", detail: "100% put back" },
  { label: "Purchasing power", detail: "More to spend on stock" },
  { label: "Inventory", detail: "Deeper range, better cover" },
  { label: "Revenue", detail: "Only what demand absorbs" },
  { label: "Profit", detail: "The loop repeats" },
];

export function ReinvestmentSection({ report }: { report: BusinessIntelligenceReport }) {
  const { reinvestmentCycle: cycle, compounding, inventoryGrowth } = report;

  const capitalSeries = [
    {
      name: "Working capital",
      color: chartColor("primary"),
      points: compounding.months.map((m) => ({
        label: m.label,
        value: m.closingCapital,
        forecast: true,
      })),
    },
    {
      name: "Cumulative reinvested profit",
      color: chartColor("success"),
      points: compounding.months.map((m) => ({
        label: m.label,
        value: m.cumulativeReinvested,
        forecast: true,
      })),
    },
  ];

  return (
    <BiSection
      id="reinvestment"
      title="Reinvestment growth"
      description="TradeBridge reinvests 100% of retained profit. This is what that loop compounds into — with each month capped by whichever binds first: what customers will buy, or what your capital can carry."
    >
      <BiCard
        title="The loop"
        description="Each step is calculated from the step before it, not assumed."
      >
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW_STEPS.map((step, i) => (
            <li
              key={`${step.label}-${i}`}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{step.label}</span>
                <span className="block text-xs text-muted-foreground">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </BiCard>

      <MetricGrid columns={4}>
        <MetricTile
          label="Estimated net profit this month"
          value={formatPkrCompactWhole(cycle.estimatedNetProfitThisMonth)}
          tone={cycle.estimatedNetProfitThisMonth >= 0 ? "neutral" : "danger"}
          info="net_profit"
        />
        <MetricTile
          label="Amount reinvested"
          value={formatPkrCompactWhole(cycle.amountReinvested)}
          hint="100% of retained profit — nothing is withdrawn."
          info="reinvestment"
        />
        <MetricTile
          label="Extra purchasing power"
          value={formatPkrCompactWhole(cycle.purchasingCapacityIncrease)}
          hint="What the reinvested profit adds to the stock base."
        />
        <MetricTile
          label="Additional inventory supported"
          value={formatPkrCompactWhole(cycle.additionalInventorySupported)}
          hint={`Rotating ${formatTurns(compounding.turnoverPerMonth)} a month at the measured pace.`}
          info="inventory_turnover"
        />
      </MetricGrid>

      <BiCard
        title="What that reinvestment could produce"
        description={cycle.note}
        action={
          cycle.cappedByDemand ? <StatusPill tone="warning">Capped by demand</StatusPill> : null
        }
      >
        <div className="space-y-0">
          <KeyValueRow
            label="Potential additional sales"
            value={formatPkr(cycle.potentialAdditionalSales)}
          />
          <KeyValueRow
            label="Potential additional gross profit"
            value={formatPkr(cycle.potentialAdditionalGrossProfit)}
            info="gross_profit"
          />
          <KeyValueRow
            label="Potential additional net profit"
            value={formatPkr(cycle.potentialAdditionalNetProfit)}
            emphasize
            tone={
              (cycle.potentialAdditionalNetProfit ?? 0) >= 0 ? "positive" : "danger"
            }
            info="net_profit"
          />
        </div>
      </BiCard>

      <BiCard
        title={`Compounding forecast — next ${report.horizonMonths} month${report.horizonMonths === 1 ? "" : "s"}`}
        description="Each month's capital base grows only by the profit the month before actually produced. Every figure is projected."
      >
        <TrendChart
          series={capitalSeries}
          ariaLabel="Projected working capital and cumulative reinvested profit"
          height={200}
        />

        <div className="mt-5">
          <ScrollTable minWidth={720} label="Compounding projection by month">
            <thead>
              <tr>
                <Th>Month</Th>
                <Th numeric>Revenue</Th>
                <Th numeric>Gross profit</Th>
                <Th numeric>Net profit</Th>
                <Th numeric>Purchasing capacity</Th>
                <Th numeric>Working capital</Th>
                <Th numeric>Cumulative reinvested</Th>
                <Th>Limited by</Th>
              </tr>
            </thead>
            <tbody>
              {compounding.months.map((month) => (
                <tr key={month.monthOffset} className="odd:bg-surface even:bg-surface-muted/40">
                  <Td className="font-medium whitespace-nowrap">{month.label}</Td>
                  <Td numeric>{formatPkrCompactWhole(month.revenue)}</Td>
                  <Td numeric>{formatPkrCompactWhole(month.grossProfit)}</Td>
                  <Td numeric className={month.netProfit < 0 ? "text-destructive" : undefined}>
                    {formatPkrCompactWhole(month.netProfit)}
                  </Td>
                  <Td numeric>{formatPkrCompactWhole(month.purchasingCapacity)}</Td>
                  <Td numeric>{formatPkrCompactWhole(month.workingCapital)}</Td>
                  <Td numeric>{formatPkrCompactWhole(month.cumulativeReinvested)}</Td>
                  <Td>
                    {month.bindingConstraint === "capital" ? (
                      <StatusPill tone="warning">Capital</StatusPill>
                    ) : month.bindingConstraint === "demand" ? (
                      <StatusPill tone="neutral">Demand</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">Not measurable</StatusPill>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </div>

        <DataNote className="mt-4">
          Total reinvested over the horizon: {formatPkr(compounding.totalReinvested)}. Inventory
          purchasing capacity next month: {formatPkr(inventoryGrowth.nextMonthPurchasingCapacity)},
          of which {formatPkr(inventoryGrowth.nextMonthCapitalIncrease)} grows the stock base — the
          rest replaces what was sold. Capacity growth over the horizon:{" "}
          {formatPercent(inventoryGrowth.points.at(-1)?.growthPct ?? null)} in the final month.
        </DataNote>
      </BiCard>
    </BiSection>
  );
}
