import { DiscardInventoryForm } from "@/app/components/inventory/DiscardInventoryForm";
import { InventoryDiscardList } from "@/app/components/inventory/InventoryDiscardList";
import { PageHeader } from "@/app/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function DiscardStockPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Discard stock"
        description="Write off damaged or failed QC items without an invoice. Stock is removed using FIFO costing and recorded as a COGS write-off."
      />

      <Card>
        <CardHeader>
          <CardTitle>Discard items</CardTitle>
          <CardDescription>
            Select products and quantities to remove from inventory. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DiscardInventoryForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent discards</CardTitle>
          <CardDescription>Latest 50 stock write-offs, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <InventoryDiscardList />
        </CardContent>
      </Card>
    </div>
  );
}
