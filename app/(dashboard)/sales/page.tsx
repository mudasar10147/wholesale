import { AddInvoiceForm } from "@/app/components/invoices/AddInvoiceForm";
import { InvoiceDraftList } from "@/app/components/invoices/InvoiceDraftList";
import { PageHeader } from "@/app/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function SalesPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Sales"
        description="Create draft invoices, then post them to finalize sales and decrement stock from invoice items."
      />

      <Card>
        <CardHeader>
          <CardTitle>Create draft invoice</CardTitle>
          <CardDescription>
            Attach products as invoice items with quantity, unit sale price, discount, delivery
            allocation, and automatic line total calculations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddInvoiceForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice lifecycle</CardTitle>
          <CardDescription>
            Manage draft, posted, and void states. Voiding posted invoices restores stock safely.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvoiceDraftList />
        </CardContent>
      </Card>

    </div>
  );
}
