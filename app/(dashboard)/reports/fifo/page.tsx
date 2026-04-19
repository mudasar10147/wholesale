import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { FifoAuditReport } from "@/app/components/reports/FifoAuditReport";
import { PageHeader } from "@/app/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function FifoReportsPage() {
  return (
    <AdminOnly>
    <div className="space-y-10">
      <PageHeader
        title="FIFO Reports"
        description="Audit FIFO inventory layers, validate stock reconciliation, and track per-invoice gross margin."
      />

      <Card>
        <CardHeader>
          <CardTitle>FIFO audit dashboard</CardTitle>
          <CardDescription>
            Includes lot aging, remaining stock valuation, per-invoice gross margin, and
            reconciliation checks between product stock, lots, and posted COGS snapshots.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FifoAuditReport />
        </CardContent>
      </Card>
    </div>
    </AdminOnly>
  );
}
