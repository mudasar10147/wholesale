import type { PartnerLoanSummary } from "@/lib/finance/partnerLoans";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { MetricRow, formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";

type PartnerLoanSummaryCardProps = {
  title: string;
  description: string;
  summary: PartnerLoanSummary | null;
  loading: boolean;
};

export function PartnerLoanSummaryCard({
  title,
  description,
  summary,
  loading,
}: PartnerLoanSummaryCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Calculating...</p>
        </CardContent>
      </Card>
    );
  }
  if (!summary) {
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

  const splits = [...summary.pendingByPartner.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-0">
        <MetricRow label="Total borrowed" value={formatMoney(summary.totalLoanIn)} />
        <MetricRow label="Total repaid" value={formatMoney(summary.totalRepaid)} />
        <MetricRow label="Pending loan" value={formatMoney(summary.pendingTotal)} emphasize />
        {splits.length > 0 ? (
          <div className="pt-3 text-xs text-muted-foreground">
            {splits.map(([partner, amount]) => (
              <p key={partner}>
                {partner}: <span className="tabular-nums text-foreground">{formatMoney(amount)}</span>
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
