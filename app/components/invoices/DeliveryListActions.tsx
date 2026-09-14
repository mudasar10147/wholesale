"use client";

import { useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { loadDeliveryBalanceGroups } from "@/lib/firestore/deliveryBalanceData";
import { useCustomers } from "@/lib/firestore/referenceData";
import type { DeliveryBalanceCustomerInput } from "@/lib/invoices/deliveryBalanceList";
import { downloadDeliveryBalanceListPdf, printDeliveryBalanceListPdf } from "@/lib/pdf/deliveryBalanceListPdf";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

type Working = "download" | "print" | null;

/**
 * Download or print the delivery / recovery list. Deliberately not role-gated: clerks
 * send out the deliveries, and every read behind the list (invoices, returns, products,
 * customers) is open to staff in the Firestore rules.
 */
export function DeliveryListActions() {
  const [working, setWorking] = useState<Working>(null);
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

  async function run(action: Exclude<Working, null>) {
    setError(null);
    setWorking(action);
    try {
      const groups = await loadDeliveryBalanceGroups(getDb(), customerById);
      if (action === "print") {
        await printDeliveryBalanceListPdf(groups);
      } else {
        await downloadDeliveryBalanceListPdf(groups);
      }
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setWorking(null);
    }
  }

  const blocked = working !== null || customers.loading;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={blocked} onClick={() => void run("download")}>
          {working === "download" ? "Preparing…" : "Download delivery list"}
        </Button>
        <Button type="button" variant="outline" disabled={blocked} onClick={() => void run("print")}>
          {working === "print" ? "Preparing…" : "Print delivery list"}
        </Button>
      </div>
      {(error ?? customers.error) ? (
        <InlineAlert variant="error" className="max-w-sm text-left text-sm">
          {error ?? customers.error}
        </InlineAlert>
      ) : null}
    </div>
  );
}
