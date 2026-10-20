import { StaffOnly } from "@/app/components/auth/StaffOnly";
import { DashboardOverview } from "@/app/components/dashboard/DashboardOverview";
import { PageHeader } from "@/app/components/layout/PageHeader";

export default function DashboardPage() {
  return (
    <StaffOnly>
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
        />

        <DashboardOverview />
      </div>
    </StaffOnly>
  );
}
