"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import { formatPercent, formatPkrCompactWhole } from "@/lib/bi/format";
import { BiCard, BiSection, DataNote } from "@/app/components/bi/BiPrimitives";
import { GroupedBarChart, TrendChart, chartColor, type SeriesPoint } from "@/app/components/bi/BiCharts";

/** How many completed months of history to plot behind the forecast. */
const HISTORY_MONTHS = 12;

export function GrowthChartsSection({ report }: { report: BusinessIntelligenceReport }) {
  const history = report.series.points.slice(-HISTORY_MONTHS);
  const historyLabels = history.map((p) => p.label.replace(" ", " "));

  const historicalPoints = (pick: (p: (typeof history)[number]) => number): SeriesPoint[] =>
    history.map((p, i) => ({ label: historyLabels[i] ?? p.label, value: pick(p) }));

  const forecastPoints = (pick: (m: BusinessIntelligenceReport["compounding"]["months"][number]) => number): SeriesPoint[] =>
    report.compounding.months.map((m) => ({ label: m.label, value: pick(m), forecast: true }));

  const revenueSeries = [
    {
      name: "Revenue",
      color: chartColor("primary"),
      points: [...historicalPoints((p) => p.revenue), ...forecastPoints((m) => m.revenue)],
    },
  ];

  const profitSeries = [
    {
      name: "Gross profit",
      color: chartColor("success"),
      points: [...historicalPoints((p) => p.grossProfit), ...forecastPoints((m) => m.grossProfit)],
    },
    {
      name: "Net profit",
      color: chartColor("accent"),
      points: [...historicalPoints((p) => p.netProfit), ...forecastPoints((m) => m.netProfit)],
    },
  ];

  const revenueVsExpenses = [
    {
      name: "Revenue",
      color: chartColor("primary"),
      points: historicalPoints((p) => p.revenue),
    },
    {
      name: "Cost of goods",
      color: chartColor("muted"),
      points: historicalPoints((p) => p.cogs),
    },
    {
      name: "Expenses",
      color: chartColor("destructive"),
      points: historicalPoints((p) => p.expenses),
    },
  ];

  const marginSeries = [
    {
      name: "Gross margin %",
      color: chartColor("success"),
      points: history.map((p, i) => ({
        label: historyLabels[i] ?? p.label,
        value: p.grossMarginPct ?? 0,
      })),
    },
  ];

  // One continuous story: what was actually bought, then what cash allows to be bought.
  const purchasingSeries = [
    {
      name: "Stock purchased → projected capacity",
      color: chartColor("accent"),
      points: [
        ...historicalPoints((p) => p.purchases),
        ...forecastPoints((m) => m.purchasingCapacity),
      ],
    },
    {
      name: "Stock sold (cost of goods)",
      color: chartColor("muted"),
      points: [...historicalPoints((p) => p.cogs), ...forecastPoints((m) => m.cogs)],
    },
  ];

  return (
    <BiSection
      id="growth-charts"
      title="Business growth"
      description="Recorded history in solid lines, projections dashed and hollow. The two are never blended."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <BiCard title="Revenue" description="Monthly revenue, historical and projected.">
          <TrendChart series={revenueSeries} ariaLabel="Monthly revenue, historical and projected" />
        </BiCard>

        <BiCard title="Profit" description="Gross and net profit by month.">
          <TrendChart series={profitSeries} ariaLabel="Monthly gross and net profit, historical and projected" />
        </BiCard>

        <BiCard title="Revenue vs costs" description="What came in against what it cost to earn.">
          <GroupedBarChart
            series={revenueVsExpenses}
            ariaLabel="Monthly revenue against cost of goods and operating expenses"
          />
        </BiCard>

        <BiCard title="Gross margin trend" description="The percentage each month kept from every rupee sold.">
          <TrendChart
            series={marginSeries}
            ariaLabel="Monthly gross margin percentage"
            valueFormatter={(n) => formatPercent(n)}
          />
        </BiCard>
      </div>

      <BiCard
        title="Stock purchasing"
        description="What has actually been bought each month, and what capacity the forecast allows."
      >
        <GroupedBarChart
          series={purchasingSeries}
          ariaLabel="Monthly stock purchases and projected purchasing capacity"
        />
        <DataNote className="mt-3">
          Purchases come from recorded supplier receipts. Capacity is projected from cash and
          expected collections — it starts where the recorded history ends. Current inventory at
          cost: {formatPkrCompactWhole(report.inventoryGrowth.currentInventoryAtCost)}.
        </DataNote>
      </BiCard>
    </BiSection>
  );
}
