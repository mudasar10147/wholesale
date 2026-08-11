"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import type { MonthComparisonRow } from "@/lib/bi/analyze";
import {
  formatDays,
  formatPercent,
  formatPercentDelta,
  formatPkr,
  formatPkrCompactWhole,
  formatTurns,
  formatUnits,
} from "@/lib/bi/format";
import {
  BiCard,
  BiSection,
  DataNote,
  ScrollTable,
  Td,
  Th,
} from "@/app/components/bi/BiPrimitives";
import { cn } from "@/lib/utils";

function formatByType(value: number | null, format: MonthComparisonRow["format"]): string {
  if (value === null) return "—";
  switch (format) {
    case "money":
      return formatPkrCompactWhole(value);
    case "percent":
      return formatPercent(value);
    case "days":
      return formatDays(value);
    case "turns":
      return formatTurns(value);
    default:
      return formatUnits(value);
  }
}

export function MonthComparisonSection({ report }: { report: BusinessIntelligenceReport }) {
  const { monthComparison, workingCapital, receivables, inventoryEfficiency, products } = report;

  const snapshotRows: { label: string; value: string; note: string }[] = [
    {
      label: "Working capital",
      value: formatPkr(workingCapital.available),
      note: "Position today — not a monthly figure.",
    },
    {
      label: "Owed by customers",
      value: formatPkr(receivables.totalOutstanding),
      note: `${receivables.invoiceCount} unpaid invoice${receivables.invoiceCount === 1 ? "" : "s"} right now.`,
    },
    {
      label: "Inventory turnover",
      value: `${formatTurns(inventoryEfficiency.turnoverPerMonth)} / month`,
      note: "Measured across the selected analysis period.",
    },
    {
      label: "Stock at cost",
      value: formatPkr(products.totalInventoryValue),
      note: "FIFO lot balances as they stand now.",
    },
  ];

  return (
    <BiSection
      id="month-comparison"
      title="This month vs last month"
      description="The current month is only part-way through, so last month is scaled to the same number of elapsed days — otherwise a half month would always look like a collapse."
    >
      <BiCard
        title={`${monthComparison.currentLabel} vs ${monthComparison.previousLabel}`}
        description="Like-for-like comparison of trading activity."
      >
        <ScrollTable minWidth={620} label="Month over month comparison">
          <thead>
            <tr>
              <Th>Metric</Th>
              <Th numeric>This month</Th>
              <Th numeric>Last month</Th>
              <Th numeric>Difference</Th>
              <Th numeric>Change</Th>
            </tr>
          </thead>
          <tbody>
            {monthComparison.rows.map((row) => {
              const direction = row.change === null ? 0 : Math.sign(row.change);
              return (
                <tr key={row.label} className="odd:bg-surface even:bg-surface-muted/40">
                  <Td className="font-medium">{row.label}</Td>
                  <Td numeric>{formatByType(row.current, row.format)}</Td>
                  <Td numeric>{formatByType(row.previous, row.format)}</Td>
                  <Td
                    numeric
                    className={cn(
                      direction > 0 ? "text-success" : direction < 0 ? "text-destructive" : undefined,
                    )}
                  >
                    <span aria-hidden="true" className="mr-1">
                      {direction > 0 ? "▲" : direction < 0 ? "▼" : "—"}
                    </span>
                    {formatByType(row.change, row.format)}
                  </Td>
                  <Td
                    numeric
                    className={cn(
                      direction > 0 ? "text-success" : direction < 0 ? "text-destructive" : undefined,
                    )}
                  >
                    {formatPercentDelta(row.changePct)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </ScrollTable>

        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold text-foreground">Position today</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {snapshotRows.map((row) => (
              <div key={row.label} className="rounded-lg border border-border bg-surface-muted px-3 py-2.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {row.label}
                </p>
                <p className="mt-1 tabular-nums text-base font-semibold text-foreground">{row.value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.note}</p>
              </div>
            ))}
          </div>
        </div>

        <DataNote className="mt-4">
          Inventory on hand for past months is reconstructed by rolling today&apos;s lot balances
          backwards through recorded receipts and cost of goods sold — TradeBridge does not store
          historical stock valuations, so treat those two rows as close estimates.
        </DataNote>
      </BiCard>
    </BiSection>
  );
}
