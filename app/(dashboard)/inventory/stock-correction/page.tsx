import { StaffOnly } from "@/app/components/auth/StaffOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { StockCorrectionWorkspace } from "@/app/components/inventory/StockCorrectionWorkspace";

export default function StockCorrectionPage() {
  return (
    <StaffOnly>
      <div className="space-y-6">
        <PageHeader
          title="Physical stock correction"
          description="Re-baseline products to their physically counted warehouse quantities. Admins only."
        />
        <StockCorrectionWorkspace />
      </div>
    </StaffOnly>
  );
}
