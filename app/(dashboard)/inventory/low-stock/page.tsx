import { Suspense } from "react";
import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { LowStockPageContent } from "@/app/components/inventory/LowStockPageContent";
import { PageHeader } from "@/app/components/layout/PageHeader";

export default function LowStockPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Low stock & reorder alerts"
          description="Find products at or below your chosen stock level. Adjust the threshold to see what needs restocking."
        />
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          }
        >
          <LowStockPageContent />
        </Suspense>
      </div>
    </AdminOnly>
  );
}
