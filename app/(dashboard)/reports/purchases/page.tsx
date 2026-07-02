import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PurchaseReport } from "@/app/components/reports/PurchaseReport";
import { PageHeader } from "@/app/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function PurchaseReportsPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Purchase report"
          description="Track inventory stocked in by trader and by day from FIFO purchase receipts."
        />

        <Card>
          <CardHeader>
            <CardTitle>Stock-in purchases</CardTitle>
            <CardDescription>
              Aggregates stock-in lots by trader from Traders management. Each receipt links to a
              trader record with contact details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PurchaseReport />
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
