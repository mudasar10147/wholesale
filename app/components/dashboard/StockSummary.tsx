import type { StockSummaryData } from "@/lib/inventory/stockSummary";
import { LOW_STOCK_THRESHOLD } from "@/lib/inventory/stockSummary";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";

type StockSummaryProps = {
  data: StockSummaryData | null;
  loading: boolean;
};

export function StockSummary({ data, loading }: StockSummaryProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stock summary</CardTitle>
          <CardDescription>Products on hand and low-stock alerts.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stock summary</CardTitle>
          <CardDescription>Products on hand and low-stock alerts.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No data.</p>
        </CardContent>
      </Card>
    );
  }

  const { productCount, totalUnits, totalValueAtCost, lowStockItems } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock summary</CardTitle>
        <CardDescription>
          Total SKUs and units. Inventory value uses current product cost × units on hand (same basis as
          dashboard COGS). Low stock is ≤ {LOW_STOCK_THRESHOLD} units.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Products
            </p>
            <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
              {productCount.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total units on hand
            </p>
            <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
              {totalUnits.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total inventory value
            </p>
            <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
              {formatMoney(totalValueAtCost)}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              At current product cost × stock on hand.
            </p>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground">Low stock</h3>
          {lowStockItems.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No products at or below {LOW_STOCK_THRESHOLD} units.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[320px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-4 py-2.5 font-semibold text-foreground">Product</th>
                    <th className="px-4 py-2.5 font-semibold text-foreground">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockItems.map((row, i) => (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-b border-border last:border-b-0",
                        i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                      )}
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{row.name}</td>
                      <td className="px-4 py-2.5 tabular-nums text-foreground">
                        {row.stock_quantity.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
