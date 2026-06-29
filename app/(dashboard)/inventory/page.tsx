import { Suspense } from "react";
import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { InventoryManagementPageContent } from "@/app/components/inventory/InventoryManagementPageContent";
import { PageHeader } from "@/app/components/layout/PageHeader";

export default function InventoryPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Inventory"
          description="Manage stock levels and costing in one place: stock in and out, FIFO lots, low-stock alerts, write-offs, and manual sale pricing."
        />
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          }
        >
          <InventoryManagementPageContent />
        </Suspense>
      </div>
    </AdminOnly>
  );
}
