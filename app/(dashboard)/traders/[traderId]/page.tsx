import { StaffOnly } from "@/app/components/auth/StaffOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { TraderProfileContent } from "@/app/components/traders/TraderProfileContent";

export default function TraderProfilePage() {
  return (
    <StaffOnly>
      <div className="space-y-6">
        <PageHeader
          title="Trader profile"
          description="Contact details and everything purchased from this trader: units, amount paid, and recent receipts."
        />
        <TraderProfileContent />
      </div>
    </StaffOnly>
  );
}
