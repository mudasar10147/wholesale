import { CustomerCrudPanel } from "@/app/components/customers/CustomerCrudPanel";
import { CustomerLedgerTable } from "@/app/components/customers/CustomerLedgerTable";
import { PageHeader } from "@/app/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function CustomersPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Customers"
        description="Create, edit, and archive customer records for invoice-based sales tracking."
      />

      <Card>
        <CardHeader>
          <CardTitle>Customer management</CardTitle>
          <CardDescription>
            Add new customers, update their details, and archive old records without deleting history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerCrudPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer ledger</CardTitle>
          <CardDescription>
            Revenue analytics by customer: purchased, paid/unpaid, discounts, delivery charges,
            and net revenue contribution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerLedgerTable />
        </CardContent>
      </Card>
    </div>
  );
}
