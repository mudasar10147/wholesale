import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { BusinessIntelligenceContent } from "@/app/components/bi/BusinessIntelligenceContent";

export default function BusinessIntelligencePage() {
  return (
    <AdminOnly>
      <div className="space-y-6">
        <PageHeader
          title="Business Intelligence"
          description="Forecast growth, profitability, inventory requirements, working capital and cash flow using your actual TradeBridge data."
        />
        <BusinessIntelligenceContent />
      </div>
    </AdminOnly>
  );
}
