import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { TraderProfileContent } from "@/app/components/traders/TraderProfileContent";

export default function TraderProfilePage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Trader profile"
          description="Contact details and everything purchased from this trader: units, amount paid, and recent receipts."
        />
        <TraderProfileContent />
      </div>
    </AdminOnly>
  );
}
