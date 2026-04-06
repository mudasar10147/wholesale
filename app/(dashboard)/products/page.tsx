import { AddProductForm } from "@/app/components/products/AddProductForm";
import { ProductList } from "@/app/components/products/ProductList";
import { PageHeader } from "@/app/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function ProductsPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Products"
        description="Add items, adjust stock with stock in / stock out, and see live updates from Firestore."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add product</CardTitle>
          <CardDescription>
            Required: name, cost price, sale price, and stock quantity. Category is optional.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddProductForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All products</CardTitle>
          <CardDescription>
            Sorted by most recently added. Use Inventory to add or remove stock without leaving this page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductList />
        </CardContent>
      </Card>
    </div>
  );
}
