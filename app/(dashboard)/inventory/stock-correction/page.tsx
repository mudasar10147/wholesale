import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { StockCorrectionWorkspace } from "@/app/components/inventory/StockCorrectionWorkspace";

export default function StockCorrectionPage() {
  return (
    <AdminOnly>
      <div className="space-y-8">
        <PageHeader
          title="Physical stock correction"
          description="Re-baseline products to their physically counted warehouse quantities. Admins only."
        />
        <StockCorrectionWorkspace />
      </div>
    </AdminOnly>
  );
}
