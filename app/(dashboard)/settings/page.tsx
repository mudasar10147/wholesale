import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { CustomerEngagementSettingsForm } from "@/app/components/settings/CustomerEngagementSettingsForm";
import { NewArrivalSettingsForm } from "@/app/components/settings/NewArrivalSettingsForm";
import { UserManagementSection } from "@/app/components/settings/UserManagementSection";
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
          description="Configure business rules used across the app — the new arrival window and customer engagement tiers."
        />

        <Card>
          <CardHeader>
            <CardTitle>New arrivals</CardTitle>
            <CardDescription>
              Set how long a newly created product is flagged as a new arrival. The “New” tag
              shows across products, inventory and the social planner while a product is inside
              this window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewArrivalSettingsForm />
          </CardContent>
        </Card>

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

        <Card>
          <CardHeader>
            <CardTitle>Users &amp; roles</CardTitle>
            <CardDescription>
              Create sign-in accounts and set what each person can do. Admins get full access
              including payments and settings; clerks handle day-to-day sales; the social
              manager sees only the social planner.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UserManagementSection />
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
