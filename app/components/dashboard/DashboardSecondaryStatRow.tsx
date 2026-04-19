import type { CashInHandSnapshot } from "@/lib/finance/loadCashInHand";
import type { PartnerLoanSummary } from "@/lib/finance/partnerLoans";
import type { StockSummaryData } from "@/lib/inventory/stockSummary";
import { StatCard } from "@/app/components/ui/StatCard";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";
import { cn } from "@/lib/utils";

type DashboardSecondaryStatRowProps = {
  cashSnapshot: CashInHandSnapshot | null;
  cashLoading: boolean;
  stock: StockSummaryData | null;
  stockAndLoansLoading: boolean;
  loanAllTime: PartnerLoanSummary | null;
};

function StatSkeleton({ className }: { className?: string }) {
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

export function DashboardSecondaryStatRow({
  cashSnapshot,
  cashLoading,
  stock,
  stockAndLoansLoading,
  loanAllTime,
}: DashboardSecondaryStatRowProps) {
  const loading = cashLoading || stockAndLoansLoading;

  if (loading) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Total assets, inventory, and loan snapshot"
      >
        {[1, 2, 3, 4].map((k) => (
          <StatSkeleton key={k} />
        ))}
      </div>
    );
  }

  const cash = cashSnapshot?.totalCashInHand;
  const inventory = stock?.totalValueAtCost;
  const hasCash = typeof cash === "number" && Number.isFinite(cash);
  const hasInv = typeof inventory === "number" && Number.isFinite(inventory);
  const totalAssets = hasCash && hasInv ? cash + inventory : null;

  const units = stock?.totalUnits;
  const hasUnits = typeof units === "number" && Number.isFinite(units);

  const pending = loanAllTime?.pendingTotal;
  const hasPending = typeof pending === "number" && Number.isFinite(pending);

  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Total assets, inventory, and loan snapshot"
    >
      <StatCard
        label="Total assets"
        value={totalAssets !== null ? formatMoney(totalAssets) : "—"}
        hint="Cash on hand plus inventory at cost."
      />
      <StatCard
        label="Total units on hand"
        value={hasUnits ? units.toLocaleString() : "—"}
        hint="Sum of stock quantities across products."
      />
      <StatCard
        label="Total inventory value"
        value={hasInv ? formatMoney(inventory) : "—"}
        hint="At current product cost × units on hand."
      />
      <StatCard
        label="Pending loan"
        value={hasPending ? formatMoney(pending) : "—"}
        hint="Company amount still owed to partners (all time)."
      />
    </div>
  );
}
