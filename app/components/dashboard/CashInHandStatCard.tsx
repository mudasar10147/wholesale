import type { CashInHandSnapshot } from "@/lib/finance/loadCashInHand";
import { StatCard } from "@/app/components/ui/StatCard";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";
import { cn } from "@/lib/utils";

type CashInHandStatCardProps = {
  snapshot: CashInHandSnapshot | null;
  loading: boolean;
  className?: string;
};

export function CashInHandStatCard({ snapshot, loading, className }: CashInHandStatCardProps) {
  if (loading) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border bg-surface p-5 shadow-card",
          className,
        )}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">…</p>
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border bg-surface p-5 shadow-card",
          className,
        )}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Total cash in hand
        </p>
        <p className="mt-2 text-sm text-muted-foreground">No data.</p>
      </div>
    );
  }

  return (
    <StatCard
      className={className}
      label="Total cash in hand"
      value={formatMoney(snapshot.totalCashInHand)}
      hint="All-time estimate from recorded flows."
    />
  );
}
