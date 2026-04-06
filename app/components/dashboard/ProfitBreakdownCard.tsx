import type { ProfitBreakdown } from "@/lib/profit/metrics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";

export function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function MetricRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm last:border-b-0",
        emphasize && "border-border-strong pt-1",
      )}
    >
      <span className={cn("text-muted-foreground", emphasize && "font-medium text-foreground")}>
        {label}
      </span>
      <span className={cn("tabular-nums text-foreground", emphasize && "text-base font-semibold")}>
        {value}
      </span>
    </div>
  );
}

type ProfitBreakdownCardProps = {
  title: string;
  description: string;
  breakdown: ProfitBreakdown | null;
  loading: boolean;
};

export function ProfitBreakdownCard({
  title,
  description,
  breakdown,
  loading,
}: ProfitBreakdownCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Calculating…</p>
        </CardContent>
      </Card>
    );
  }

  if (!breakdown) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No data.</p>
        </CardContent>
      </Card>
    );
  }

  const { totalSales, totalExpenses, cogs, profit } = breakdown;
  const profitPositive = profit >= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-0">
        <MetricRow label="Total sales" value={formatMoney(totalSales)} />
        <MetricRow label="Total expenses" value={formatMoney(totalExpenses)} />
        <MetricRow label="Cost of goods sold" value={formatMoney(cogs)} />
        <div className="pt-2">
          <MetricRow label="Profit / (loss)" value={formatMoney(profit)} emphasize />
          <p
            className={cn(
              "mt-2 text-xs font-medium",
              profitPositive ? "text-success" : "text-destructive",
            )}
          >
            {profitPositive ? "Net positive for this period." : "Net negative for this period."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
