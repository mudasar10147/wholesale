import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { PricingMarginPageContent } from "@/app/components/pricing/PricingMarginPageContent";

export default function PricingMarginPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Pricing & margin management"
          description="Control product pricing, target margins, and profitability. Automatic mode keeps sale prices aligned with cost and target margin."
        />
        <PricingMarginPageContent />
      </div>
    </AdminOnly>
  );
}
