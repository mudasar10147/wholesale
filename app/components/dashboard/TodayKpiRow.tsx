import type { ProfitBreakdown } from "@/lib/profit/metrics";
import { StatCard } from "@/app/components/ui/StatCard";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";
import { cn } from "@/lib/utils";

type TodayKpiRowProps = {
  today: ProfitBreakdown | null;
  loading: boolean;
};

export function TodayKpiRow({ today, loading }: TodayKpiRowProps) {
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

  const sales = today?.totalSales ?? 0;
  const expenses = today?.totalExpenses ?? 0;
  const profit = today?.profit ?? 0;
  const profitPositive = profit >= 0;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Total sales today" value={formatMoney(sales)} />
      <StatCard label="Total expenses today" value={formatMoney(expenses)} />
      <StatCard
        label="Profit today"
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
