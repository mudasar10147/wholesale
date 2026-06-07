import type { ReactNode } from "react";
import type { StockSummaryData } from "@/lib/inventory/stockSummary";
import { LOW_STOCK_THRESHOLD } from "@/lib/inventory/stockSummary";
import {
  formatInventoryDays,
  inventoryDaysHealthHint,
  type WeeklyInventoryVelocity,
} from "@/lib/inventory/turnoverMetrics";
import {
  grossMarginPercent,
  netMarginPercent,
  type ProfitBreakdown,
} from "@/lib/profit/metrics";
import type { YtdWeeklySalesSummary } from "@/lib/profit/loadPeriod";
import { StatCard } from "@/app/components/ui/StatCard";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";

export type DashboardExtendedKpiGridProps = {
  breakdown: ProfitBreakdown | null;
  stock: StockSummaryData | null;
  customerCount: number | null;
  rollingVelocity: WeeklyInventoryVelocity | null;
  ytdWeeklySales: YtdWeeklySalesSummary | null;
  loading: boolean;
  periodLabel: string;
};

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function StatSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">…</p>
      <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

function KpiSection({
  title,
  description,
  gridClassName = "sm:grid-cols-2 lg:grid-cols-3",
  children,
}: {
  title: string;
  description?: string;
  gridClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className={`grid gap-4 ${gridClassName}`}>{children}</div>
    </section>
  );
}

export function DashboardExtendedKpiGrid({
  breakdown,
  stock,
  customerCount,
  rollingVelocity: velocity,
  ytdWeeklySales,
  loading,
  periodLabel,
}: DashboardExtendedKpiGridProps) {
  const periodHint = `In selected period (${periodLabel.toLowerCase()})`;
  const grossPct = breakdown ? grossMarginPercent(breakdown) : null;
  const netPct = breakdown ? netMarginPercent(breakdown) : null;
  const damagedValue = breakdown?.damagedWriteOffs ?? 0;
  const daysHealth = inventoryDaysHealthHint(velocity?.daysToSellInventory ?? null);
  const weekLabel = velocity?.weekLabel ?? "Mon–Sun week";
  const noSalesHint = `No sales COGS for route week ${weekLabel}. Post invoices for that week.`;

  if (loading) {
    return (
      <div className="space-y-8" aria-label="Extended KPIs">
        <KpiSection title="Period performance" gridClassName="sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <StatSkeleton key={i} />
          ))}
        </KpiSection>
        {["Inventory velocity", "Inventory on hand", "Stock and customers"].map((title) => (
          <KpiSection key={title} title={title}>
            {[1, 2, 3].map((i) => (
              <StatSkeleton key={i} />
            ))}
          </KpiSection>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8" aria-label="Extended KPIs">
      <KpiSection
        title="Period performance"
        gridClassName="sm:grid-cols-2 lg:grid-cols-4"
        description={`Margins and write-offs for ${periodLabel.toLowerCase()}, plus average weekly sales year to date.`}
      >
        <StatCard label="Gross margin %" value={formatPercent(grossPct)} hint={periodHint} />
        <StatCard label="Net margin %" value={formatPercent(netPct)} hint={periodHint} />
        <StatCard
          label="Damaged items value"
          value={formatMoney(damagedValue)}
          hint={`Return discards + stock discards. ${periodHint}.`}
        />
        <StatCard
          label="Avg weekly sales (YTD)"
          value={
            ytdWeeklySales?.avgWeeklySales != null
              ? formatMoney(ytdWeeklySales.avgWeeklySales)
              : "—"
          }
          hint={
            ytdWeeklySales?.avgWeeklySales != null
              ? `${formatMoney(ytdWeeklySales.totalSales)} total ÷ ${ytdWeeklySales.weeksElapsed.toFixed(1)} weeks (${ytdWeeklySales.rangeLabel}). Posted invoice & walk-in sales.`
              : "No sales recorded yet this year."
          }
        />
      </KpiSection>

      <KpiSection
        title="Inventory velocity"
        description={`Based on calendar week Mon–Sun (${weekLabel}). Mon–Sat uses the last completed route week; Sunday uses the current week. Not tied to the date picker.`}
      >
        <StatCard
          label="Weekly COGS (Mon–Sun)"
          value={velocity ? formatMoney(velocity.weeklyCogs) : "—"}
          hint={
            velocity && velocity.avgDailyCogs != null
              ? `Total stock cost sold that week across all routes. Week: ${weekLabel}.`
              : noSalesHint
          }
        />
        <StatCard
          label="Avg daily COGS"
          value={velocity?.avgDailyCogs != null ? formatMoney(velocity.avgDailyCogs) : "—"}
          hint={
            velocity?.avgDailyCogs != null
              ? "Weekly COGS ÷ 7 — smooths high/low route days (e.g. 20k vs 50k)."
              : noSalesHint
          }
        />
        <StatCard
          label="Days to sell inventory"
          value={formatInventoryDays(velocity?.daysToSellInventory ?? null)}
          hint={
            velocity?.daysToSellInventory != null
              ? `${daysHealth ?? ""} At the ${weekLabel} route-week pace.`.trim()
              : noSalesHint
          }
        />
      </KpiSection>

      <KpiSection
        title="Inventory on hand"
        description="Current snapshot — if all stock sold at list price (cost from FIFO lots)."
      >
        <StatCard
          label="Inventory at retail"
          value={stock ? formatMoney(stock.totalValueAtRetail) : "—"}
          hint="Stock × list sale price."
        />
        <StatCard
          label="Unrealized profit on stock"
          value={stock ? formatMoney(stock.unrealizedGrossProfit) : "—"}
          hint="Retail value minus FIFO lot cost."
        />
        <StatCard
          label="Unrealized gross margin %"
          value={stock ? formatPercent(stock.inventoryMarginPct) : "—"}
          hint="(Retail − lot cost) ÷ retail."
        />
      </KpiSection>

      <KpiSection title="Stock and customers" description="Reorder alerts and customer count.">
        <StatCard
          label="Products need reorder"
          value={stock ? stock.reorderCount.toLocaleString() : "—"}
          hint={`Stock 1–${LOW_STOCK_THRESHOLD} units.`}
        />
        <StatCard
          label="Out of stock count"
          value={stock ? stock.outOfStockCount.toLocaleString() : "—"}
          hint="Zero units on hand."
        />
        <StatCard
          label="Total customers"
          value={customerCount !== null ? customerCount.toLocaleString() : "—"}
          hint="Active customers (not archived)."
        />
      </KpiSection>
    </div>
  );
}
