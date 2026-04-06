import { AddSaleForm } from "@/app/components/sales/AddSaleForm";
import { SalesList } from "@/app/components/sales/SalesList";
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
        description="Record a sale: choose a product and quantity. Stock is reduced automatically using each product's sale price."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add sale</CardTitle>
          <CardDescription>
            Sale total uses the product&apos;s current sale price × quantity. Insufficient stock is
            blocked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddSaleForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent sales</CardTitle>
          <CardDescription>Latest 50 sales, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <SalesList />
        </CardContent>
      </Card>
    </div>
  );
}
