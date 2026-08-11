"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import { formatPkr, formatPkrCompactWhole } from "@/lib/bi/format";
import {
  BiCard,
  BiSection,
  DataNote,
  ScrollTable,
  StatusPill,
  Td,
  Th,
} from "@/app/components/bi/BiPrimitives";
import { GroupedBarChart, chartColor } from "@/app/components/bi/BiCharts";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

export function CashFlowSection({ report }: { report: BusinessIntelligenceReport }) {
  const { cashFlow } = report;

  const series = [
    {
      name: "Money in",
      color: chartColor("success"),
      points: cashFlow.horizons.map((h) => ({ label: h.label.replace("Next ", ""), value: h.totalInflows, forecast: true })),
    },
    {
      name: "Money out",
      color: chartColor("destructive"),
      points: cashFlow.horizons.map((h) => ({ label: h.label.replace("Next ", ""), value: h.totalOutflows, forecast: true })),
    },
    {
      name: "Closing cash",
      color: chartColor("primary"),
      points: cashFlow.horizons.map((h) => ({ label: h.label.replace("Next ", ""), value: h.closingCash, forecast: true })),
    },
  ];

  return (
    <BiSection
      id="cash-flow"
      title="Cash flow forecast"
      description="Where cash lands over the next 7, 30, 60 and 90 days, from recorded balances and the current trading pace."
    >
      {cashFlow.warnings.length > 0 ? (
        <div className="space-y-2">
          {cashFlow.warnings.map((warning) => (
            <InlineAlert key={warning.id} variant={warning.severity === "danger" ? "error" : "warning"}>
              <span className="block font-semibold">{warning.title}</span>
              <span className="mt-0.5 block">{warning.detail}</span>
            </InlineAlert>
          ))}
        </div>
      ) : (
        <InlineAlert variant="success">
          No cash-flow risk detected over the next 90 days at the current trading pace.
        </InlineAlert>
      )}

      <BiCard title="Projected cash position" description="All figures are projections.">
        <GroupedBarChart series={series} ariaLabel="Projected cash inflows, outflows and closing balance" height={210} />

        <div className="mt-5">
          <ScrollTable minWidth={760} label="Cash flow forecast by horizon">
            <thead>
              <tr>
                <Th>Horizon</Th>
                <Th numeric>Opening cash</Th>
                <Th numeric>Customer collections</Th>
                <Th numeric>New sales collected</Th>
                <Th numeric>Expenses</Th>
                <Th numeric>Stock purchases</Th>
                <Th numeric>Closing cash</Th>
              </tr>
            </thead>
            <tbody>
              {cashFlow.horizons.map((h) => (
                <tr key={h.id} className="odd:bg-surface even:bg-surface-muted/40">
                  <Td className="whitespace-nowrap font-medium">{h.label}</Td>
                  <Td numeric>{formatPkrCompactWhole(h.openingCash)}</Td>
                  <Td numeric>{formatPkrCompactWhole(h.collectionsFromReceivables)}</Td>
                  <Td numeric>{formatPkrCompactWhole(h.collectionsFromNewSales)}</Td>
                  <Td numeric>−{formatPkrCompactWhole(h.operatingExpenses)}</Td>
                  <Td numeric>−{formatPkrCompactWhole(h.inventoryPurchases)}</Td>
                  <Td numeric>
                    <span className={h.isNegative ? "font-semibold text-destructive" : "font-semibold text-foreground"}>
                      {formatPkrCompactWhole(h.closingCash)}
                    </span>
                    {h.isNegative ? (
                      <span className="ml-2 inline-block align-middle">
                        <StatusPill tone="danger">Negative</StatusPill>
                      </span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </div>

        <div className="mt-5">
          <h4 className="text-sm font-semibold text-foreground">What this assumes</h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
            {cashFlow.assumptions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <DataNote className="mt-4">
          Buying stock is a cash outflow but not an expense until the stock sells, so purchases
          appear here and never in the profit figures. Opening cash is TradeBridge&apos;s existing
          cash-in-hand estimate ({formatPkr(report.cash.totalCashInHand)}).
        </DataNote>
      </BiCard>
    </BiSection>
  );
}
