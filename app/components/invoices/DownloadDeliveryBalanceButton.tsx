"use client";

import { useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { buildDeliveryBalanceList } from "@/lib/invoices/deliveryBalanceList";
import { downloadDeliveryBalanceListPdf } from "@/lib/pdf/deliveryBalanceListPdf";
import type { CustomerDoc, InvoiceDoc } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

export function DownloadDeliveryBalanceButton() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      const db = getDb();
      const [invoiceSnap, customerSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.invoices), orderBy("created_at", "desc"))),
        getDocs(collection(db, COLLECTIONS.customers)),
      ]);

      const customerById = new Map<string, Pick<CustomerDoc, "name" | "phone" | "address">>();
      customerSnap.forEach((docSnap) => {
        const customer = docSnap.data() as CustomerDoc;
        customerById.set(docSnap.id, {
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
        });
      });

      const invoices = invoiceSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as InvoiceDoc),
      }));

      const rows = buildDeliveryBalanceList(invoices, customerById);
      await downloadDeliveryBalanceListPdf(rows);
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" disabled={downloading} onClick={() => void handleDownload()}>
        {downloading ? "Preparing…" : "Download delivery list"}
      </Button>
      {error ? (
        <InlineAlert variant="error" className="max-w-sm text-left text-sm">
          {error}
        </InlineAlert>
      ) : null}
    </div>
  );
}
