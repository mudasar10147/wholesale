"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import {
  formatPercent,
  formatPercentagePoints,
  formatPkr,
  formatPkrCompactWhole,
  formatUnits,
} from "@/lib/bi/format";
import {
  BiCard,
  BiSection,
  DataNote,
  EmptyState,
  InsufficientData,
  KeyValueRow,
  MetricGrid,
  MetricTile,
  ScrollTable,
  StatusPill,
  Td,
  Th,
} from "@/app/components/bi/BiPrimitives";
import { ComparisonBars, chartColor } from "@/app/components/bi/BiCharts";
import type { ProductIntelRow } from "@/lib/bi/productIntelligence";

export function ProfitabilitySection({ report }: { report: BusinessIntelligenceReport }) {
  const { periodTotals, previousTotals, products, expenses, breakEven } = report;

  const marginShift =
    periodTotals.grossMarginPct !== null && previousTotals.grossMarginPct !== null
      ? periodTotals.grossMarginPct - previousTotals.grossMarginPct
      : null;

  return (
    <BiSection
      id="profitability"
      title="Profitability"
      description="Where the margin comes from, what the running costs take away, and the sales level that covers everything."
    >
      <MetricGrid columns={4}>
        <MetricTile
          label="Gross margin"
          value={formatPercent(periodTotals.grossMarginPct)}
          info="gross_margin"
          hint={`vs ${formatPercent(previousTotals.grossMarginPct)} in the previous period`}
        />
        <MetricTile
          label="Margin change"
          value={formatPercentagePoints(marginShift)}
          tone={marginShift === null ? "neutral" : marginShift >= 0 ? "positive" : "danger"}
          hint="Percentage points, not a percentage change."
        />
        <MetricTile
          label="Markup on cost"
          value={formatPercent(
            periodTotals.cogs > 0 ? (periodTotals.grossProfit / periodTotals.cogs) * 100 : null,
          )}
          info="markup"
          hint="Same profit, measured against cost instead of price."
        />
        <MetricTile
          label="Net margin"
          value={formatPercent(periodTotals.netMarginPct)}
          tone={
            periodTotals.netMarginPct === null
              ? "neutral"
              : periodTotals.netMarginPct >= 0
                ? "positive"
                : "danger"
          }
          info="net_profit"
        />
      </MetricGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <BiCard title="Period result" description="Selected analysis period, from posted sales and recorded expenses.">
          <div className="space-y-0">
            <KeyValueRow label="Revenue" value={formatPkr(periodTotals.revenue)} />
            <KeyValueRow label="Cost of goods sold" value={`−${formatPkr(periodTotals.cogs)}`} />
            <KeyValueRow label="Gross profit" value={formatPkr(periodTotals.grossProfit)} info="gross_profit" />
            <KeyValueRow label="Operating expenses" value={`−${formatPkr(periodTotals.expenses)}`} />
            <KeyValueRow
              label="Net profit"
              value={formatPkr(periodTotals.netProfit)}
              emphasize
              tone={periodTotals.netProfit >= 0 ? "positive" : "danger"}
            />
          </div>
          <DataNote className="mt-3">
            Stock bought in the period ({formatPkr(periodTotals.purchases)}) is a cash outflow, not
            an expense — it only becomes a cost through COGS when it sells. Damaged write-offs of{" "}
            {formatPkr(periodTotals.writeOffs)} are reported separately, matching how the main
            dashboard treats them.
          </DataNote>
        </BiCard>

        <BiCard title="Margin by category" description="Where the gross profit actually comes from.">
          {products.categories.length === 0 ? (
            <EmptyState>No sales recorded in this period.</EmptyState>
          ) : (
            <ScrollTable minWidth={560} label="Gross margin by category">
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th numeric>Revenue</Th>
                  <Th numeric>COGS</Th>
                  <Th numeric>Gross profit</Th>
                  <Th numeric>Margin</Th>
                </tr>
              </thead>
              <tbody>
                {products.categories.slice(0, 12).map((row) => (
                  <tr key={row.category} className="odd:bg-surface even:bg-surface-muted/40">
                    <Td className="font-medium">{row.category}</Td>
                    <Td numeric>{formatPkrCompactWhole(row.revenue)}</Td>
                    <Td numeric>{formatPkrCompactWhole(row.cogs)}</Td>
                    <Td numeric>{formatPkrCompactWhole(row.grossProfit)}</Td>
                    <Td numeric>{formatPercent(row.marginPct)}</Td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          )}
        </BiCard>
      </div>

      <ProductMarginCard products={products} />
      <ExpenseCard report={report} />

      <BiCard title="Break-even" description="The monthly sales level that covers every cost.">
        {breakEven.breakEvenRevenue === null ? (
          <InsufficientData metric="Break-even revenue" reason={breakEven.sentence} />
        ) : (
          <>
            <MetricGrid columns={4}>
              <MetricTile
                label="Break-even revenue"
                value={`${formatPkrCompactWhole(breakEven.breakEvenRevenue)}/month`}
                info="break_even"
              />
              <MetricTile
                label="Current revenue"
                value={`${formatPkrCompactWhole(breakEven.currentRevenue)}/month`}
              />
              <MetricTile
                label="Difference"
                value={formatPkrCompactWhole(breakEven.difference)}
                tone={(breakEven.difference ?? 0) >= 0 ? "positive" : "danger"}
              />
              <MetricTile
                label="Margin of safety"
                value={formatPercent(breakEven.marginOfSafetyPct)}
                info="margin_of_safety"
                tone={
                  breakEven.marginOfSafetyPct === null
                    ? "neutral"
                    : breakEven.marginOfSafetyPct >= 20
                      ? "positive"
                      : breakEven.marginOfSafetyPct >= 0
                        ? "warning"
                        : "danger"
                }
              />
            </MetricGrid>
            <p className="mt-4 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-foreground">
              {breakEven.sentence}
            </p>
            <DataNote className="mt-3">
              Fixed costs of {formatPkr(breakEven.fixedCosts)} a month against a contribution margin
              of {formatPercent(breakEven.contributionMarginPct)} (gross margin less variable running
              costs). Expenses that could not be classified are treated as fixed here, which is the
              cautious assumption. {expenses.note}
            </DataNote>
          </>
        )}
      </BiCard>
    </BiSection>
  );
}

function ProductLine({ row, metric }: { row: ProductIntelRow; metric: "margin" | "profit" | "revenue" }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
      <span className="min-w-0 truncate text-foreground">{row.name}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {metric === "margin"
          ? formatPercent(row.marginPct)
          : metric === "profit"
            ? formatPkrCompactWhole(row.grossProfit)
            : formatPkrCompactWhole(row.revenue)}
      </span>
    </li>
  );
}

function ProductMarginCard({ products }: { products: BusinessIntelligenceReport["products"] }) {
  const lists: {
    title: string;
    note: string;
    rows: readonly ProductIntelRow[];
    metric: "margin" | "profit" | "revenue";
  }[] = [
    {
      title: "Highest margin",
      note: "Best return per rupee of sales.",
      rows: products.highestMargin,
      metric: "margin",
    },
    {
      title: "Lowest margin",
      note: "Thin per sale — check volume before acting.",
      rows: products.lowestMargin,
      metric: "margin",
    },
    {
      title: "Biggest gross profit",
      note: "What actually earns the most money.",
      rows: products.highestGrossProfit,
      metric: "profit",
    },
    {
      title: "Good margin, low volume",
      note: "Worth pushing — the margin is already there.",
      rows: products.goodMarginLowVolume,
      metric: "margin",
    },
    {
      title: "High volume, thin margin",
      note: "Reprice or renegotiate cost. Volume like this is worth keeping.",
      rows: products.highVolumeLowMargin,
      metric: "revenue",
    },
  ];

  return (
    <BiCard
      title="Product margin intelligence"
      description="A low margin is not a reason to drop a product — volume and rotation matter just as much."
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {lists.map((list) => (
          <div key={list.title}>
            <h4 className="text-sm font-semibold text-foreground">{list.title}</h4>
            <p className="mb-1.5 text-xs text-muted-foreground">{list.note}</p>
            {list.rows.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Not enough sales to rank.</p>
            ) : (
              <ul>
                {list.rows.slice(0, 5).map((row) => (
                  <ProductLine key={`${list.title}-${row.productId}`} row={row} metric={list.metric} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </BiCard>
  );
}

function ExpenseCard({ report }: { report: BusinessIntelligenceReport }) {
  const { expenses, periodTotals, previousTotals } = report;
  const { breakdown } = expenses;
  const revenueChangePct =
    previousTotals.revenue > 0
      ? ((periodTotals.revenue - previousTotals.revenue) / previousTotals.revenue) * 100
      : 0;

  const structureRows = [
    { label: "Fixed", value: breakdown.fixed, color: chartColor("primary") },
    { label: "Variable", value: breakdown.variable, color: chartColor("accent") },
    { label: "Unclassified", value: breakdown.unknown, color: chartColor("muted") },
  ].filter((r) => r.value > 0);

  return (
    <BiCard
      title="Expense analysis"
      description="Categories are derived from each expense's title — TradeBridge has no category field, so nothing is guessed silently."
    >
      <MetricGrid columns={3}>
        <MetricTile
          label="Total expenses"
          value={formatPkrCompactWhole(expenses.totalExpenses)}
          hint={`Across ${breakdown.categories.reduce((n, c) => n + c.count, 0)} recorded entries.`}
        />
        <MetricTile
          label="Expenses as % of revenue"
          value={formatPercent(expenses.expenseRatioPct)}
          info="expense_ratio"
          tone={
            expenses.expenseRatioPct === null || periodTotals.grossMarginPct === null
              ? "neutral"
              : expenses.expenseRatioPct >= periodTotals.grossMarginPct
                ? "danger"
                : expenses.expenseRatioPct >= periodTotals.grossMarginPct * 0.75
                  ? "warning"
                  : "positive"
          }
          hint={`Previous period: ${formatPercent(expenses.previousExpenseRatioPct)}. Gross margin: ${formatPercent(periodTotals.grossMarginPct)}.`}
        />
        <MetricTile
          label="Unclassified share"
          value={formatPercent(breakdown.unclassifiedSharePct)}
          tone={
            breakdown.unclassifiedSharePct !== null && breakdown.unclassifiedSharePct >= 30
              ? "warning"
              : "neutral"
          }
          hint="Left unclassified rather than assigned on a guess. Clearer expense titles shrink this."
        />
      </MetricGrid>

      {structureRows.length > 0 ? (
        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold text-foreground">Fixed vs variable</h4>
          <ComparisonBars rows={structureRows} ariaLabel="Fixed versus variable expenses" />
          <DataNote className="mt-3">
            Fixed costs stay the same whatever you sell; variable costs move with volume. Anything
            that could not be classified is kept separate and never scaled with revenue in the
            forecast. {expenses.note}
          </DataNote>
        </div>
      ) : null}

      <div className="mt-5">
        <h4 className="mb-2 text-sm font-semibold text-foreground">By category</h4>
        {breakdown.categories.length === 0 ? (
          <EmptyState>No expenses recorded in this period.</EmptyState>
        ) : (
          <ScrollTable minWidth={640} label="Expenses by category">
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>Type</Th>
                <Th numeric>Amount</Th>
                <Th numeric>Share</Th>
                <Th numeric>Previous</Th>
                <Th numeric>Change</Th>
              </tr>
            </thead>
            <tbody>
              {breakdown.categories.map((row) => {
                // Flag a line only when it is growing meaningfully faster than the
                // revenue that has to pay for it.
                const outpacing =
                  row.changePct !== null &&
                  row.changePct > 10 &&
                  row.changePct > revenueChangePct + 10;
                return (
                  <tr key={row.id} className="odd:bg-surface even:bg-surface-muted/40">
                    <Td className="font-medium">
                      <span className="block">{row.label}</span>
                      <span className="block text-xs font-normal text-muted-foreground">{row.note}</span>
                    </Td>
                    <Td>
                      <StatusPill tone={row.nature === "fixed" ? "neutral" : row.nature === "variable" ? "warning" : "neutral"}>
                        {row.nature === "unknown" ? "Unclassified" : row.nature}
                      </StatusPill>
                    </Td>
                    <Td numeric>{formatPkrCompactWhole(row.amount)}</Td>
                    <Td numeric>{formatPercent(row.sharePct)}</Td>
                    <Td numeric>{row.previousAmount === null ? "—" : formatPkrCompactWhole(row.previousAmount)}</Td>
                    <Td numeric className={outpacing ? "text-destructive" : undefined}>
                      {formatPercent(row.changePct)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </ScrollTable>
        )}
      </div>

      <DataNote className="mt-3">
        Total units sold in period: {formatUnits(periodTotals.unitsSold)} across{" "}
        {formatUnits(periodTotals.orderCount)} invoices (average order{" "}
        {formatPkr(periodTotals.avgOrderValue)}).
      </DataNote>
    </BiCard>
  );
}
