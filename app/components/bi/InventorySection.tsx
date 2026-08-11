"use client";

import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import type { ProductIntelRow } from "@/lib/bi/productIntelligence";
import { DEAD_STOCK_DAYS, SLOW_STOCK_COVER_DAYS } from "@/lib/bi/productIntelligence";
import {
  formatDays,
  formatPercent,
  formatPkr,
  formatPkrCompactWhole,
  formatTurns,
  formatUnits,
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
import { TrendChart, chartColor } from "@/app/components/bi/BiCharts";

export function InventorySection({ report }: { report: BusinessIntelligenceReport }) {
  const { inventoryEfficiency: eff, inventoryGrowth, products } = report;

  const growthSeries = [
    {
      name: "Inventory on hand (projected)",
      color: chartColor("primary"),
      points: [
        { label: "Now", value: inventoryGrowth.currentInventoryAtCost },
        ...inventoryGrowth.points.map((p) => ({
          label: p.label,
          value: p.inventoryOnHand,
          forecast: true,
        })),
      ],
    },
    {
      name: "Purchasing capacity (projected)",
      color: chartColor("accent"),
      points: [
        { label: "Now", value: inventoryGrowth.points[0]?.purchasingCapacity ?? 0 },
        ...inventoryGrowth.points.map((p) => ({
          label: p.label,
          value: p.purchasingCapacity,
          forecast: true,
        })),
      ],
    },
  ];

  return (
    <BiSection
      id="inventory"
      title="Inventory efficiency & growth"
      description="How fast stock money rotates, how much capital is stuck, and where the stock base is heading."
    >
      <MetricGrid columns={4}>
        <MetricTile
          label="Inventory turnover"
          value={eff.turnoverPerMonth === null ? "—" : `${formatTurns(eff.turnoverPerMonth)} / month`}
          info="inventory_turnover"
          hint={
            eff.turnoverForPeriod === null
              ? "Needs recorded stock cost sold and stock on hand."
              : `${formatTurns(eff.turnoverForPeriod)} over the selected ${eff.periodDays}-day period.`
          }
        />
        <MetricTile
          label="Average holding period"
          value={formatDays(eff.holdingDays)}
          info="inventory_days"
          hint="How long stock waits before selling."
        />
        <MetricTile
          label="Capital rotation"
          value={
            eff.salesPerHundredThousand === null
              ? "—"
              : `${formatPkrCompactWhole(eff.salesPerHundredThousand)}`
          }
          hint="Monthly sales generated per Rs. 100,000 of inventory."
        />
        <MetricTile
          label="Stock on hand at cost"
          value={formatPkrCompactWhole(eff.currentInventoryAtCost)}
          hint={`Average across the period: ${formatPkrCompactWhole(eff.averageInventory)}`}
        />
      </MetricGrid>

      <p className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-foreground">
        {eff.rotationSentence}
      </p>

      <BiCard
        title="Inventory growth forecast"
        description="Stock on hand, what gets bought, and what the cash allows — three different things, kept apart."
      >
        <MetricGrid columns={4}>
          <MetricTile
            label="Current inventory value"
            value={formatPkrCompactWhole(inventoryGrowth.currentInventoryAtCost)}
            hint="At FIFO lot cost."
          />
          <MetricTile
            label="Next-month purchasing capacity"
            value={formatPkrCompactWhole(inventoryGrowth.nextMonthPurchasingCapacity)}
            info="purchasing_capacity"
            hint="Replacement buying plus growth buying."
          />
          <MetricTile
            label="Expected capital increase"
            value={formatPkrCompactWhole(inventoryGrowth.nextMonthCapitalIncrease)}
            hint="Only reinvested profit grows the stock base."
          />
          <MetricTile
            label="Expected inventory growth"
            value={formatPercent(inventoryGrowth.nextMonthGrowthPct)}
            tone={(inventoryGrowth.nextMonthGrowthPct ?? 0) >= 0 ? "positive" : "danger"}
          />
        </MetricGrid>

        <div className="mt-5">
          <TrendChart
            series={growthSeries}
            ariaLabel="Projected inventory on hand and purchasing capacity"
            height={200}
          />
        </div>

        <div className="mt-5">
          <ScrollTable minWidth={640} label="Inventory growth by month">
            <thead>
              <tr>
                <Th>Month</Th>
                <Th numeric>Inventory on hand</Th>
                <Th numeric>Stock purchased</Th>
                <Th numeric>Purchasing capacity</Th>
                <Th numeric>Capital increase</Th>
                <Th numeric>Growth</Th>
              </tr>
            </thead>
            <tbody>
              {inventoryGrowth.points.map((point) => (
                <tr key={point.monthOffset} className="odd:bg-surface even:bg-surface-muted/40">
                  <Td className="whitespace-nowrap font-medium">{point.label}</Td>
                  <Td numeric>{formatPkrCompactWhole(point.inventoryOnHand)}</Td>
                  <Td numeric>{formatPkrCompactWhole(point.purchases)}</Td>
                  <Td numeric>{formatPkrCompactWhole(point.purchasingCapacity)}</Td>
                  <Td numeric>{formatPkrCompactWhole(point.capitalIncrease)}</Td>
                  <Td numeric>{formatPercent(point.growthPct)}</Td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </div>

        <DataNote className="mt-4">
          Stock purchased each month replaces what was sold plus whatever profit is reinvested;
          purchasing capacity is what cash and collections allow. They are not the same number, and
          neither is the same as working capital.
        </DataNote>
      </BiCard>

      <StockEfficiencyCard products={products} />
      <StockOutCard report={report} />
    </BiSection>
  );
}

function ProductTable({
  rows,
  emptyMessage,
  showVelocity = true,
}: {
  rows: readonly ProductIntelRow[];
  emptyMessage: string;
  showVelocity?: boolean;
}) {
  if (rows.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;

  return (
    <ScrollTable minWidth={720} label="Product stock analysis">
      <thead>
        <tr>
          <Th>Product</Th>
          <Th>Category</Th>
          <Th numeric>Qty</Th>
          <Th numeric>Stock value</Th>
          <Th numeric>Days held</Th>
          <Th numeric>Margin</Th>
          {showVelocity ? <Th numeric>Units / day</Th> : null}
          <Th>Why</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.productId} className="odd:bg-surface even:bg-surface-muted/40">
            <Td className="font-medium">{row.name}</Td>
            <Td>{row.category}</Td>
            <Td numeric>{formatUnits(row.stockQuantity)}</Td>
            <Td numeric>{formatPkrCompactWhole(row.inventoryValue)}</Td>
            <Td numeric>{row.oldestLotAgeDays === null ? "—" : `${row.oldestLotAgeDays}`}</Td>
            <Td numeric>{formatPercent(row.marginPct)}</Td>
            {showVelocity ? (
              <Td numeric>{row.velocityPerDay === null ? "—" : row.velocityPerDay.toFixed(2)}</Td>
            ) : null}
            <Td className="text-xs text-muted-foreground">{row.classReason}</Td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

function StockEfficiencyCard({ products }: { products: BusinessIntelligenceReport["products"] }) {
  return (
    <BiCard
      title="Stock efficiency"
      description={`Fast movers are close to running out; slow movers hold more than ${SLOW_STOCK_COVER_DAYS} days of cover; dead stock has not sold in ${DEAD_STOCK_DAYS} days. Products added in the last 45 days are never judged.`}
    >
      <MetricGrid columns={3}>
        <MetricTile
          label="Capital in slow-moving stock"
          value={formatPkrCompactWhole(products.capitalTrappedSlow)}
          tone={products.capitalTrappedSlow > 0 ? "warning" : "positive"}
          hint={`${products.slowMoving.length} product${products.slowMoving.length === 1 ? "" : "s"}`}
        />
        <MetricTile
          label="Capital in dead stock"
          value={formatPkrCompactWhole(products.capitalTrappedDead)}
          tone={products.capitalTrappedDead > 0 ? "danger" : "positive"}
          hint={`${products.deadStock.length} product${products.deadStock.length === 1 ? "" : "s"}`}
        />
        <MetricTile
          label="Total capital trapped"
          value={formatPkrCompactWhole(products.capitalTrappedTotal)}
          tone={
            products.capitalTrappedSharePct === null
              ? "neutral"
              : products.capitalTrappedSharePct >= 25
                ? "danger"
                : products.capitalTrappedSharePct >= 10
                  ? "warning"
                  : "positive"
          }
          hint={
            products.capitalTrappedSharePct === null
              ? "No stock value recorded."
              : `${formatPercent(products.capitalTrappedSharePct)} of ${formatPkrCompactWhole(products.totalInventoryValue)} total stock value.`
          }
        />
      </MetricGrid>

      <p className="mt-4 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-foreground">
        {products.capitalTrappedTotal > 0
          ? `Approximately ${formatPkr(products.capitalTrappedTotal)} is currently tied up in slow-moving and dead inventory. That is cash sitting on shelves rather than rotating.`
          : "No capital is currently sitting in slow-moving or dead inventory."}
      </p>

      <div className="mt-6 space-y-6">
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            Fast-moving stock{" "}
            <span className="font-normal text-muted-foreground">
              ({products.fastMoving.length})
            </span>
          </h4>
          <ProductTable
            rows={products.fastMoving.slice(0, 10)}
            emptyMessage="No product is running low at its current selling pace."
          />
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            Slow-moving stock{" "}
            <span className="font-normal text-muted-foreground">
              ({products.slowMoving.length})
            </span>
          </h4>
          <ProductTable
            rows={products.slowMoving.slice(0, 10)}
            emptyMessage="Nothing is sitting longer than expected."
          />
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            Dead stock{" "}
            <span className="font-normal text-muted-foreground">({products.deadStock.length})</span>
          </h4>
          <ProductTable
            rows={products.deadStock.slice(0, 10)}
            emptyMessage={`No product with stock on hand has gone ${DEAD_STOCK_DAYS} days without a sale.`}
          />
        </div>
      </div>
    </BiCard>
  );
}

function StockOutCard({ report }: { report: BusinessIntelligenceReport }) {
  const exposure = report.products.stockOutExposure;

  return (
    <BiCard
      title="Stock-outs & lost-sales exposure"
      description="Products that were selling and are now at zero stock."
    >
      {exposure.rows.length === 0 ? (
        <InsufficientData
          metric="Lost sales from stock-outs"
          reason={`${exposure.sentence} ${exposure.dataNote}`}
        />
      ) : (
        <>
          <MetricGrid columns={3}>
            <MetricTile
              label="Monthly sales exposure"
              value={formatPkrCompactWhole(exposure.monthlyRevenueExposure)}
              tone="warning"
              hint={`${exposure.productCount} product${exposure.productCount === 1 ? "" : "s"} affected.`}
            />
            <MetricTile
              label="Monthly gross profit exposure"
              value={formatPkrCompactWhole(exposure.monthlyGrossProfitExposure)}
              tone="warning"
              info="gross_profit"
            />
            <MetricTile
              label="Share of monthly revenue"
              value={formatPercent(exposure.exposureSharePct)}
              tone={
                exposure.exposureSharePct === null
                  ? "neutral"
                  : exposure.exposureSharePct >= 8
                    ? "danger"
                    : "warning"
              }
            />
          </MetricGrid>

          <p className="mt-4 text-sm leading-relaxed text-foreground">{exposure.sentence}</p>

          <div className="mt-4">
            <ScrollTable minWidth={600} label="Out-of-stock products">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th>Category</Th>
                  <Th numeric>Sales / day</Th>
                  <Th numeric>Monthly exposure</Th>
                  <Th numeric>Gross profit at risk</Th>
                  <Th numeric>Days since last sale</Th>
                </tr>
              </thead>
              <tbody>
                {exposure.rows.slice(0, 12).map((row) => (
                  <tr key={row.productId} className="odd:bg-surface even:bg-surface-muted/40">
                    <Td className="font-medium">{row.name}</Td>
                    <Td>{row.category}</Td>
                    <Td numeric>{formatPkrCompactWhole(row.dailyRevenue)}</Td>
                    <Td numeric>{formatPkrCompactWhole(row.monthlyRevenueExposure)}</Td>
                    <Td numeric>{formatPkrCompactWhole(row.monthlyGrossProfitExposure)}</Td>
                    <Td numeric>{row.daysSinceLastSale ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusPill tone="neutral">Forward exposure, not recorded losses</StatusPill>
          </div>
          <DataNote className="mt-2">{exposure.dataNote}</DataNote>
        </>
      )}
    </BiCard>
  );
}
