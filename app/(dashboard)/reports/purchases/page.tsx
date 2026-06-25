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
          description="Track inventory stocked in by shop and by day from FIFO purchase receipts."
        />

        <Card>
          <CardHeader>
            <CardTitle>Stock-in purchases</CardTitle>
            <CardDescription>
              Aggregates stock-in lots only. Each stock-in on the products page creates one receipt with shop,
              quantity, cost, and received date.
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
