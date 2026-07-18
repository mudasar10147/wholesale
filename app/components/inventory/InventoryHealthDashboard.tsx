"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  loadPendingLedgerDocuments,
  repairInvoiceSaleLedger,
  repairReturnLedger,
  type PendingLedgerRow,
} from "@/lib/inventory/repairLedger";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export function InventoryHealthDashboard() {
  const [pending, setPending] = useState<PendingLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadPendingLedgerDocuments(getDb());
      setPending(rows);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRepair(row: PendingLedgerRow) {
    setRepairingId(row.id);
    setSuccess(null);
    setError(null);
    try {
      const db = getDb();
      if (row.kind === "invoice") {
        await repairInvoiceSaleLedger(db, row.id);
      } else {
        await repairReturnLedger(db, row.id);
      }
      setSuccess(`Ledger repaired for ${row.kind} ${row.id}`);
      await refresh();
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setRepairingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory health</CardTitle>
        <CardDescription>
          Pending or failed inventory ledger writes. Stock may be committed while the audit ledger is
          missing — use repair to backfill idempotently.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
        {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Pending ledger writes:{" "}
            <strong className="text-foreground">{loading ? "…" : pending.length}</strong>
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </Button>
          <Link href="/reports/fifo" className="text-primary underline-offset-2 hover:underline">
            FIFO audit report
          </Link>
          <span className="text-xs">
            Nightly validation: <code className="text-foreground">npm run validate:inventory:nightly</code>
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading pending ledger queue…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending or failed ledger documents.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Ledger status</th>
                  <th className="px-3 py-2 font-medium">Error</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={`${row.kind}-${row.id}`} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                    <td className="px-3 py-2">{row.kind}</td>
                    <td className="px-3 py-2">{row.ledger_status ?? "—"}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground">
                      {row.ledger_error ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={repairingId === row.id}
                        onClick={() => void handleRepair(row)}
                      >
                        {repairingId === row.id ? "Repairing…" : "Repair ledger"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
