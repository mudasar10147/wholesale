import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { AddTraderButton } from "@/app/components/traders/AddTraderButton";
import { TraderCrudPanel } from "@/app/components/traders/TraderCrudPanel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function TradersPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Traders"
          description="Suppliers you buy stock from. Create, edit, and archive traders, then pick them when stocking in."
          action={<AddTraderButton />}
        />

        <Card>
          <CardHeader>
            <CardTitle>Trader management</CardTitle>
            <CardDescription>
              View and manage traders, or archive ones you no longer use. Open a trader to see
              everything purchased from them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TraderCrudPanel />
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
