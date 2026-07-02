import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { CustomerEngagementSettingsForm } from "@/app/components/settings/CustomerEngagementSettingsForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function SettingsPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Settings"
          description="Configure business rules used across the app. Changes apply to customer engagement tiers on the Customers page."
        />

        <Card>
          <CardHeader>
            <CardTitle>Customer engagement</CardTitle>
            <CardDescription>
              Set tier thresholds (order frequency and spend in the rolling window) and the discount
              percentage offered to Premium and Silver customers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomerEngagementSettingsForm />
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
