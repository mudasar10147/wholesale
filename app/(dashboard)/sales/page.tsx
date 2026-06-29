import { InvoiceDraftList } from "@/app/components/invoices/InvoiceDraftList";
import { ReturnList } from "@/app/components/invoices/ReturnList";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { ButtonLink } from "@/app/components/ui/Button";
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
        action={
          <ButtonLink href="/sales/new" variant="primary">
            Create New Invoice
          </ButtonLink>
        }
      />

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

      <Card>
        <CardHeader>
          <CardTitle>Returns</CardTitle>
          <CardDescription>
            Draft and posted returns against invoices. Open a draft to post it or delete it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReturnList />
        </CardContent>
      </Card>

    </div>
  );
}
