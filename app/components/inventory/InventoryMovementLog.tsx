"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { InventoryTransactionDoc, InventoryTransactionLineDoc } from "@/lib/types/firestore";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

type TxnRow = InventoryTransactionDoc & { id: string };
type LineRow = InventoryTransactionLineDoc & { id: string };

function formatDate(ts?: Timestamp) {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

export function InventoryMovementLog({ productId }: { productId?: string }) {
  const [transactions, setTransactions] = useState<TxnRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    let done = 0;
    const mark = () => {
      done += 1;
      if (done >= 2) setLoading(false);
    };

    const unsubTx = onSnapshot(
      query(collection(db, COLLECTIONS.inventoryTransactions), orderBy("posted_at", "desc"), limit(100)),
      (snap) => {
        const next: TxnRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InventoryTransactionDoc) }));
        setTransactions(next);
        mark();
      },
      (err) => {
        setError(getFirestoreUserMessage(err));
        setLoading(false);
      },
    );

    const unsubLines = onSnapshot(
      collection(db, COLLECTIONS.inventoryTransactionLines),
      (snap) => {
        const next: LineRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InventoryTransactionLineDoc) }));
        setLines(next);
        mark();
      },
      (err) => {
        setError(getFirestoreUserMessage(err));
        setLoading(false);
      },
    );

    return () => {
      unsubTx();
      unsubLines();
    };
  }, []);

  const linesByTxn = new Map<string, LineRow[]>();
  for (const line of lines) {
    if (productId && line.product_id !== productId) continue;
    const arr = linesByTxn.get(line.transaction_id) ?? [];
    arr.push(line);
    linesByTxn.set(line.transaction_id, arr);
  }

  const visibleTxns = productId
    ? transactions.filter((t) => (linesByTxn.get(t.id)?.length ?? 0) > 0)
    : transactions;

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading inventory movements…</p>;
  }

  if (error) {
    return (
      <InlineAlert variant="error" className="text-sm">
        {error}
      </InlineAlert>
    );
  }

  if (visibleTxns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No inventory transactions yet. New stock movements are recorded here from stock in/out,
        adjustments, and invoices.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-3 py-2 font-semibold">When</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Reference</th>
            <th className="px-3 py-2 font-semibold">Product</th>
            <th className="px-3 py-2 font-semibold">Qty</th>
            <th className="px-3 py-2 font-semibold">Reason</th>
          </tr>
        </thead>
        <tbody>
          {visibleTxns.slice(0, 50).map((txn) => {
            const txnLines = linesByTxn.get(txn.id) ?? [];
            return txnLines.map((line, idx) => (
              <tr key={`${txn.id}-${line.id}`} className="border-b border-border">
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {idx === 0 ? formatDate(txn.posted_at) : ""}
                </td>
                <td className="px-3 py-2">{idx === 0 ? txn.type : ""}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {idx === 0 ? txn.source_document_id ?? txn.transaction_number : ""}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{line.product_id}</td>
                <td className="px-3 py-2 tabular-nums">
                  {line.direction === "out" ? "−" : "+"}
                  {line.quantity}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{idx === 0 ? txn.reason ?? "—" : ""}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
