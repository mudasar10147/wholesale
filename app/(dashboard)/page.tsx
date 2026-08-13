import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { DashboardOverview } from "@/app/components/dashboard/DashboardOverview";
import { PageHeader } from "@/app/components/layout/PageHeader";

export default function DashboardPage() {
  return (
    <AdminOnly>
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
        />

        <DashboardOverview />
      </div>
    </AdminOnly>
  );
}
