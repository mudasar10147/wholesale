import { StaffOnly } from "@/app/components/auth/StaffOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { ProductProfileContent } from "@/app/components/products/ProductProfileContent";

export default function ProductProfilePage() {
  return (
    <StaffOnly>
      <div className="space-y-6">
        <PageHeader
          title="Product profile"
          description="Image, pricing, stock, sales analytics, FIFO lots summary, and invoice line stats for this SKU."
        />
        <ProductProfileContent />
      </div>
    </StaffOnly>
  );
}
