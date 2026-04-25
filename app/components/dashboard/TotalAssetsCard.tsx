import type { CashInHandSnapshot } from "@/lib/finance/loadCashInHand";
import type { StockSummaryData } from "@/lib/inventory/stockSummary";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { MetricRow, formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";

type TotalAssetsCardProps = {
  cashSnapshot: CashInHandSnapshot | null;
  cashLoading: boolean;
  stock: StockSummaryData | null;
  stockLoading: boolean;
};

export function TotalAssetsCard({
  cashSnapshot,
  cashLoading,
  stock,
  stockLoading,
}: TotalAssetsCardProps) {
  const loading = cashLoading || stockLoading;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Total assets</CardTitle>
          <CardDescription>
            Cash on hand plus inventory at cost (current product cost × units on hand).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  const cash = cashSnapshot?.totalCashInHand;
  const inventory = stock?.totalValueAtCost;
  const hasCash = typeof cash === "number" && Number.isFinite(cash);
  const hasInv = typeof inventory === "number" && Number.isFinite(inventory);
  const total =
    hasCash && hasInv ? cash + inventory : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Total assets</CardTitle>
        <CardDescription>
          Cash on hand plus inventory at cost (current product cost × units on hand). Other balance
          sheet items are not included. This is not the same as liquid cash.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-0">
          <MetricRow
            label="Total cash in hand"
            value={hasCash ? formatMoney(cash) : "—"}
          />
          <MetricRow
            label="Total inventory value"
            value={hasInv ? formatMoney(inventory) : "—"}
          />
        </div>
        <div className="border-t border-border pt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total assets
          </p>
          <p className="mt-1 tabular-nums text-2xl font-semibold text-foreground">
            {total !== null ? formatMoney(total) : "—"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
