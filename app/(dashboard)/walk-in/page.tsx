import { PageHeader } from "@/app/components/layout/PageHeader";
import { WalkInSalesPageContent } from "@/app/components/walkIn/WalkInSalesPageContent";

export default function WalkInPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Walk-in sales"
        description="Record shop counter sales as drafts. An admin approves them to update inventory and daily sales totals."
      />
      <WalkInSalesPageContent />
    </div>
  );
}
