"use client";

import { DownloadDeliveryBalanceButton } from "@/app/components/invoices/DownloadDeliveryBalanceButton";
import { ButtonLink } from "@/app/components/ui/Button";

export function SalesPageHeaderActions() {
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <DownloadDeliveryBalanceButton />
      <ButtonLink href="/sales/new" variant="primary">
        Create New Invoice
      </ButtonLink>
    </div>
  );
}
