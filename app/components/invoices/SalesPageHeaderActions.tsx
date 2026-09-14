"use client";

import { DeliveryListActions } from "@/app/components/invoices/DeliveryListActions";
import { ButtonLink } from "@/app/components/ui/Button";

export function SalesPageHeaderActions() {
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <DeliveryListActions />
      <ButtonLink href="/sales/new" variant="primary">
        Create New Invoice
      </ButtonLink>
    </div>
  );
}
