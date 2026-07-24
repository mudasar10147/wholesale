import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { PhysicalStockCorrectionCard } from "@/app/components/inventory/PhysicalStockCorrectionCard";

export default function StockCorrectionPage() {
  return (
    <AdminOnly>
      <div className="space-y-8">
        <PageHeader
          title="Physical stock correction"
          description="Re-baseline a product to its physically counted warehouse quantity. Admins only."
        />
        <PhysicalStockCorrectionCard />
      </div>
    </AdminOnly>
  );
}
