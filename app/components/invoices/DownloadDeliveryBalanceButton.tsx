"use client";

import { useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { loadDeliveryBalanceGroups } from "@/lib/firestore/deliveryBalanceData";
import { useCustomers } from "@/lib/firestore/referenceData";
import type { DeliveryBalanceCustomerInput } from "@/lib/invoices/deliveryBalanceList";
import { downloadDeliveryBalanceListPdf } from "@/lib/pdf/deliveryBalanceListPdf";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

export function DownloadDeliveryBalanceButton() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shared session listener — the two lists on this page already hold it, so the shop
  // details on the PDF cost no extra reads.
  const customers = useCustomers();

  const customerById = useMemo(() => {
    const map = new Map<string, DeliveryBalanceCustomerInput>();
    for (const { id, data } of customers.rows) {
      map.set(id, { name: data.name, phone: data.phone, address: data.address });
    }
    return map;
  }, [customers.rows]);

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      const groups = await loadDeliveryBalanceGroups(getDb(), customerById);
      await downloadDeliveryBalanceListPdf(groups);
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  const blocked = downloading || customers.loading;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" disabled={blocked} onClick={() => void handleDownload()}>
        {downloading ? "Preparing…" : "Download delivery list"}
      </Button>
      {(error ?? customers.error) ? (
        <InlineAlert variant="error" className="max-w-sm text-left text-sm">
          {error ?? customers.error}
        </InlineAlert>
      ) : null}
    </div>
  );
}
