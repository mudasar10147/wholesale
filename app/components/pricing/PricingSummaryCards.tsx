import type { PricingSummary } from "@/lib/pricing/metrics";
import { StatCard } from "@/app/components/ui/StatCard";

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

type PricingSummaryCardsProps = {
  summary: PricingSummary;
  loading: boolean;
  onBelowTargetClick?: () => void;
};

function StatSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">…</p>
      <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

export function PricingSummaryCards({
  summary,
  loading,
  onBelowTargetClick,
}: PricingSummaryCardsProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }

  const lowestHint = summary.lowestMarginProduct
    ? `${summary.lowestMarginProduct.name} (${formatPercent(summary.lowestMarginProduct.marginPercent)})`
    : undefined;
  const highestHint = summary.highestMarginProduct
    ? `${summary.highestMarginProduct.name} (${formatPercent(summary.highestMarginProduct.marginPercent)})`
    : undefined;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard label="Total products" value={String(summary.totalProducts)} />
      <StatCard
        label="Average margin %"
        value={formatPercent(summary.averageMarginPercent)}
        hint="Products with a sale price > 0"
      />
      <StatCard
        label="Below target margin"
        value={String(summary.productsBelowTarget)}
        hint="Click to filter table"
        onClick={onBelowTargetClick}
        ariaLabel="Filter products below target margin"
      />
      <StatCard label="Lowest margin product" value={formatPercent(summary.lowestMarginProduct?.marginPercent ?? null)} hint={lowestHint} />
      <StatCard label="Highest margin product" value={formatPercent(summary.highestMarginProduct?.marginPercent ?? null)} hint={highestHint} />
      <StatCard
        label="Potential additional profit"
        value={formatMoney(summary.potentialAdditionalProfit)}
        hint="Estimated from current stock at target margin"
      />
    </div>
  );
}
