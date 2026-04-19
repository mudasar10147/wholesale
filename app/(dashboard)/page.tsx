import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { FirestoreSmokeTest } from "@/app/components/FirestoreSmokeTest";
import { DashboardOverview } from "@/app/components/dashboard/DashboardOverview";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/Card";

export default function DashboardPage() {
  return (
    <AdminOnly>
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
        <PageHeader
          className="flex-1 border-0 pb-0"
          title="Dashboard"
          description="Business overview: today, this month and year sales, expenses, profit, inventory value, and monthly detail."
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Overview</CardTitle>
          <CardDescription>
            Figures update from Firestore when you refresh or when data changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DashboardOverview />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>System</CardTitle>
          <CardDescription>Optional connectivity check for troubleshooting.</CardDescription>
        </CardHeader>
        <CardContent className="bg-surface-muted/50">
          <details>
            <summary className="cursor-pointer select-none text-sm font-medium text-foreground outline-none marker:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              Run Firestore connection check
            </summary>
            <div className="mt-4">
              <FirestoreSmokeTest />
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
    </AdminOnly>
  );
}
