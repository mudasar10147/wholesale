"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import { ASSUMED_CREDIT_TERM_DAYS } from "@/lib/bi/receivables";
import {
  formatDays,
  formatPercent,
  formatPkr,
  formatPkrCompactWhole,
} from "@/lib/bi/format";
import {
  BiCard,
  BiSection,
  DataNote,
  EmptyState,
  InsufficientData,
  MetricGrid,
  MetricTile,
  ScrollTable,
  StatusPill,
  Td,
  Th,
} from "@/app/components/bi/BiPrimitives";
import { ComparisonBars, chartColor } from "@/app/components/bi/BiCharts";

export function PartnersSection({ report }: { report: BusinessIntelligenceReport }) {
  const { receivables, collectionImprovement, suppliers, supplierTerms } = report;

  const bucketColors = [
    chartColor("success"),
    chartColor("accent"),
    chartColor("accent"),
    chartColor("destructive"),
    chartColor("destructive"),
  ];

  return (
    <BiSection
      id="partners"
      title="Receivables & suppliers"
      description="What customers owe you, what that costs in working capital, and where your stock comes from."
    >
      <BiCard
        title="Receivables intelligence"
        description={`Ageing is measured from the day each invoice was posted, with ${ASSUMED_CREDIT_TERM_DAYS} days treated as within terms.`}
      >
        {receivables.totalOutstanding <= 0 ? (
          <EmptyState>No customer balances are outstanding. Everything billed has been paid.</EmptyState>
        ) : (
          <>
            <MetricGrid columns={4}>
              <MetricTile
                label="Total outstanding"
                value={formatPkrCompactWhole(receivables.totalOutstanding)}
                hint={`${receivables.invoiceCount} unpaid invoice${receivables.invoiceCount === 1 ? "" : "s"}`}
              />
              <MetricTile
                label="Past terms"
                value={formatPkrCompactWhole(receivables.overdueTotal)}
                tone={
                  receivables.overdueSharePct === null
                    ? "neutral"
                    : receivables.overdueSharePct >= 40
                      ? "danger"
                      : receivables.overdueSharePct >= 15
                        ? "warning"
                        : "positive"
                }
                hint={`${formatPercent(receivables.overdueSharePct)} of the total`}
              />
              <MetricTile
                label="Average collection period"
                value={formatDays(receivables.collectionPeriodDays)}
                info="receivable_days"
                hint="Estimated from the balance against credit sales."
              />
              <MetricTile
                label="Credit share of sales"
                value={formatPercent(receivables.creditSalesSharePct)}
                hint={`${formatPkrCompactWhole(receivables.creditSalesInPeriod)} billed on invoices this period.`}
              />
            </MetricGrid>

            <div className="mt-5">
              <h4 className="mb-2 text-sm font-semibold text-foreground">Ageing</h4>
              <ComparisonBars
                ariaLabel="Receivables ageing buckets"
                rows={receivables.buckets.map((bucket, i) => ({
                  label: bucket.label,
                  value: bucket.amount,
                  color: bucketColors[i] ?? chartColor("muted"),
                  note: `${bucket.invoiceCount} invoice${bucket.invoiceCount === 1 ? "" : "s"} · ${formatPercent(bucket.sharePct)}`,
                }))}
              />
            </div>

            <div className="mt-5 rounded-lg border border-border bg-surface-muted px-4 py-3">
              <p className="text-sm leading-relaxed text-foreground">{collectionImprovement.sentence}</p>
            </div>

            <div className="mt-5">
              <h4 className="mb-2 text-sm font-semibold text-foreground">Credit exposure by customer</h4>
              <ScrollTable minWidth={640} label="Customer credit exposure">
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th numeric>Outstanding</Th>
                    <Th numeric>Past terms</Th>
                    <Th numeric>Invoices</Th>
                    <Th numeric>Oldest</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.topCustomers.slice(0, 10).map((row) => (
                    <tr key={row.customerId} className="odd:bg-surface even:bg-surface-muted/40">
                      <Td className="font-medium">{row.customerName}</Td>
                      <Td numeric>{formatPkrCompactWhole(row.outstanding)}</Td>
                      <Td numeric className={row.overdueAmount > 0 ? "text-destructive" : undefined}>
                        {row.overdueAmount > 0 ? formatPkrCompactWhole(row.overdueAmount) : "—"}
                      </Td>
                      <Td numeric>{row.invoiceCount}</Td>
                      <Td numeric>{row.oldestAgeDays === null ? "—" : `${row.oldestAgeDays}d`}</Td>
                      <Td className="text-xs text-muted-foreground">
                        {row.flags.length > 0 ? row.flags.join(" · ") : "Within normal range"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </ScrollTable>
              <DataNote className="mt-2">
                Plain, transparent flags from recorded balances and invoice ages — no credit scoring
                model, because the data does not support one.
              </DataNote>
            </div>
          </>
        )}
        <DataNote className="mt-4">{receivables.dataNote}</DataNote>
      </BiCard>

      <BiCard
        title="Supplier financing"
        description="What supplier credit would be worth, and what TradeBridge cannot yet tell you."
      >
        <MetricGrid columns={3}>
          <MetricTile
            label="Total owed to suppliers"
            value="Not tracked"
            hint="No supplier balances, invoices or due dates are recorded."
          />
          <MetricTile
            label="Average supplier payment period"
            value="Not tracked"
            info="payable_days"
            hint="Purchases behave as immediate cash outflows."
          />
          <MetricTile
            label="Stock bought this period"
            value={formatPkrCompactWhole(suppliers.totalPurchases)}
            hint={`${suppliers.suppliers.length} supplier${suppliers.suppliers.length === 1 ? "" : "s"} recorded.`}
          />
        </MetricGrid>

        <p className="mt-4 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-foreground">
          {supplierTerms.sentence}
        </p>

        <DataNote className="mt-3">{suppliers.dataNote}</DataNote>
      </BiCard>

      <BiCard
        title="Supplier performance"
        description="Compared only on what is actually recorded: what you bought, when, at what cost, and what those goods earned."
      >
        {suppliers.suppliers.length === 0 ? (
          <InsufficientData
            metric="Supplier performance"
            reason="No stock receipts are recorded in the selected period. Receive stock against a trader to build this comparison."
          />
        ) : (
          <ScrollTable minWidth={820} label="Supplier performance comparison">
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th numeric>Purchases</Th>
                <Th numeric>Share</Th>
                <Th numeric>Receipts</Th>
                <Th numeric>Avg gap</Th>
                <Th numeric>Avg unit cost</Th>
                <Th numeric>Cost trend</Th>
                <Th numeric>Margin earned</Th>
                <Th numeric>Stock still held</Th>
              </tr>
            </thead>
            <tbody>
              {suppliers.suppliers.slice(0, 12).map((row) => (
                <tr key={row.traderId} className="odd:bg-surface even:bg-surface-muted/40">
                  <Td className="font-medium">{row.name}</Td>
                  <Td numeric>{formatPkrCompactWhole(row.purchaseValue)}</Td>
                  <Td numeric>{formatPercent(row.sharePct)}</Td>
                  <Td numeric>{row.receiptCount}</Td>
                  <Td numeric>
                    {row.averageDaysBetweenPurchases === null
                      ? "—"
                      : formatDays(row.averageDaysBetweenPurchases)}
                  </Td>
                  <Td numeric>{row.averageUnitCost === null ? "—" : formatPkr(row.averageUnitCost)}</Td>
                  <Td numeric className={(row.unitCostTrendPct ?? 0) > 5 ? "text-destructive" : undefined}>
                    {formatPercent(row.unitCostTrendPct)}
                  </Td>
                  <Td numeric>{formatPercent(row.attributedMarginPct)}</Td>
                  <Td numeric>{formatPkrCompactWhole(row.stockOnHandValue)}</Td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        )}

        {suppliers.concentrationPct !== null && suppliers.concentrationPct >= 60 ? (
          <div className="mt-3">
            <StatusPill tone="warning">
              {formatPercent(suppliers.concentrationPct)} of purchases from one supplier
            </StatusPill>
          </div>
        ) : null}
      </BiCard>
    </BiSection>
  );
}
