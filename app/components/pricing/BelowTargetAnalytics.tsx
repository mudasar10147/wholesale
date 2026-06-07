import type { EnrichedPricingRow } from "@/lib/pricing/metrics";
import { formatMoney } from "@/app/components/pricing/format";

type BelowTargetAnalyticsProps = {
  rows: EnrichedPricingRow[];
  maxItems?: number;
};

export function BelowTargetAnalytics({ rows, maxItems = 8 }: BelowTargetAnalyticsProps) {
  const below = rows
    .filter((r) => r.isBelowTarget)
    .sort((a, b) => b.potentialProfitLost - a.potentialProfitLost)
    .slice(0, maxItems);

  if (below.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No products are currently selling below their target margin.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {below.map((r) => (
        <li
          key={r.id}
          className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{r.name}</p>
            <p className="text-xs text-muted-foreground">
              Margin {r.marginPercent?.toFixed(1) ?? "—"}% vs target {r.effectiveTargetMarginPercent.toFixed(1)}%
              · Stock {r.stock_quantity.toLocaleString()}
            </p>
          </div>
          <p className="shrink-0 tabular-nums text-sm font-medium text-destructive">
            Lost: {formatMoney(r.potentialProfitLost)}
          </p>
        </li>
      ))}
    </ul>
  );
}
