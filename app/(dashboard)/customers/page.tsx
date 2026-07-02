import { AddCustomerButton } from "@/app/components/customers/AddCustomerButton";
import { CustomerKpiCards } from "@/app/components/customers/CustomerKpiCards";
import { CustomerPageTabs } from "@/app/components/customers/CustomerPageTabs";
import { PageHeader } from "@/app/components/layout/PageHeader";

export default function CustomersPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Customers"
        description="Create, edit, and archive customer records for invoice-based sales tracking."
        action={<AddCustomerButton />}
      />

      <CustomerKpiCards />

      <CustomerPageTabs />
    </div>
  );
}
