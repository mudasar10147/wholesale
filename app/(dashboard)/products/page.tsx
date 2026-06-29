import { Suspense } from "react";
import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { ProductManagementPageContent } from "@/app/components/products/ProductManagementPageContent";
import { PageHeader } from "@/app/components/layout/PageHeader";

export default function ProductsPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Products"
          description="Add items, browse your catalog, and complete product details. Open a product to see its full history."
        />
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          }
        >
          <ProductManagementPageContent />
        </Suspense>
      </div>
    </AdminOnly>
  );
}
