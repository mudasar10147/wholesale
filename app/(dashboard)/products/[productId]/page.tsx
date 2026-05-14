import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { ProductProfileContent } from "@/app/components/products/ProductProfileContent";

export default function ProductProfilePage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Product profile"
          description="Image, pricing, stock, sales analytics, FIFO lots summary, and invoice line stats for this SKU."
        />
        <ProductProfileContent />
      </div>
    </AdminOnly>
  );
}
