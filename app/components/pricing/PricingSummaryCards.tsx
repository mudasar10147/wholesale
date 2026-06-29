import { StatCard } from "@/app/components/ui/StatCard";

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export type SimplePricingSummary = {
  totalProducts: number;
  totalUnits: number;
  inventoryValueAtCost: number;
  inventoryValueAtSale: number;
  profitOnStock: number;
  averageMarginPercent: number | null;
};

type PricingSummaryCardsProps = {
  summary: SimplePricingSummary;
  loading: boolean;
};

function StatSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">…</p>
      <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

export function PricingSummaryCards({ summary, loading }: PricingSummaryCardsProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <StatCard
        label="Profit on stock"
        value={formatMoney(summary.profitOnStock)}
        hint="(Sale − cost) × stock on hand"
      />
      <StatCard
        label="Average margin"
        value={formatPercent(summary.averageMarginPercent)}
        hint="Across products with a sale price"
      />
    </div>
  );
}
