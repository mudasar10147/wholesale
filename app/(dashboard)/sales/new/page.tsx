import { AddInvoiceForm } from "@/app/components/invoices/AddInvoiceForm";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { ButtonLink } from "@/app/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

type PageProps = {
  searchParams: Promise<{ customerId?: string }>;
};

export default async function NewInvoicePage({ searchParams }: PageProps) {
  const { customerId } = await searchParams;
  return (
    <div className="space-y-10">
      <PageHeader
        title="Create invoice"
        description="Attach products as invoice items with quantity, unit sale price, discounts, and delivery. Saving creates a draft and returns you to Sales."
        action={
          <ButtonLink href="/sales" variant="outline">
            ← Back to sales
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Draft invoice</CardTitle>
          <CardDescription>
            The invoice is saved as a draft. Post it from the Sales list to finalize the sale and
            decrement stock.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddInvoiceForm redirectTo="/sales" initialCustomerId={customerId?.trim()} />
        </CardContent>
      </Card>
    </div>
  );
}
