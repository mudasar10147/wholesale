import type { ProfitBreakdown } from "@/lib/profit/metrics";
import { StatCard } from "@/app/components/ui/StatCard";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";
import { cn } from "@/lib/utils";

export type PeriodKpiRowProps = {
  breakdown: ProfitBreakdown | null;
  loading: boolean;
  salesLabel: string;
  expensesLabel: string;
  profitLabel: string;
  onSalesClick?: () => void;
};

export function PeriodKpiRow({
  breakdown,
  loading,
  salesLabel,
  expensesLabel,
  profitLabel,
  onSalesClick,
}: PeriodKpiRowProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((k) => (
          <div
            key={k}
            className="rounded-xl border border-border bg-surface p-5 shadow-card"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              …
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
          </div>
        ))}
      </div>
    );
  }

  const sales = breakdown?.totalSales ?? 0;
  const expenses = breakdown?.totalExpenses ?? 0;
  const profit = breakdown?.profit ?? 0;
  const profitPositive = profit >= 0;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        label={salesLabel}
        value={formatMoney(sales)}
        onClick={onSalesClick}
        ariaLabel={`${salesLabel}: ${formatMoney(sales)}. Open sale line details.`}
      />
      <StatCard label={expensesLabel} value={formatMoney(expenses)} />
      <StatCard
        label={profitLabel}
        value={formatMoney(profit)}
        hint={
          <span
            className={cn(
              "font-medium",
              profitPositive ? "text-success" : "text-destructive",
            )}
          >
            After COGS (current product costs).
          </span>
        }
      />
    </div>
  );
}
