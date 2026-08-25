"use client";

import { useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { loadDeliveryBalanceGroups } from "@/lib/firestore/deliveryBalanceData";
import { downloadDeliveryBalanceListPdf } from "@/lib/pdf/deliveryBalanceListPdf";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

export function DownloadDeliveryBalanceButton() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      const groups = await loadDeliveryBalanceGroups(getDb());
      await downloadDeliveryBalanceListPdf(groups);
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
