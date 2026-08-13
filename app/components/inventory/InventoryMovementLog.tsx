"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where, type Timestamp } from "firebase/firestore";
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

/** Firestore rejects an `in` filter with more than 30 comparison values. */
const IN_QUERY_MAX_VALUES = 30;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function InventoryMovementLog({ productId }: { productId?: string }) {
  const [transactions, setTransactions] = useState<TxnRow[]>([]);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [lines, setLines] = useState<LineRow[]>([]);
  /** Which transaction set `lines` currently covers, so partial loads are not shown. */
  const [linesKey, setLinesKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const unsubTx = onSnapshot(
      query(collection(db, COLLECTIONS.inventoryTransactions), orderBy("posted_at", "desc"), limit(100)),
      (snap) => {
        const next: TxnRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InventoryTransactionDoc) }));
        setTransactions(next);
        setTransactionsLoaded(true);
      },
      (err) => {
        setError(getFirestoreUserMessage(err));
        setTransactionsLoaded(true);
      },
    );
    return () => unsubTx();
  }, []);

  const txnIdsKey = useMemo(() => transactions.map((t) => t.id).join(","), [transactions]);

  /**
   * Lines are fetched for the transactions actually on screen. Reading the whole
   * collection here meant the log pulled every line ever written (661 in
   * production) to render 100 rows; scoping to the visible headers reads only
   * what those rows need.
   */
  useEffect(() => {
    if (!txnIdsKey) return;
    const db = getDb();
    const groups = chunk(txnIdsKey.split(","), IN_QUERY_MAX_VALUES);
    const buffers: LineRow[][] = groups.map(() => []);
    const reported = new Set<number>();

    const unsubs = groups.map((group, i) =>
      onSnapshot(
        query(
          collection(db, COLLECTIONS.inventoryTransactionLines),
          where("transaction_id", "in", group),
        ),
        (snap) => {
          const next: LineRow[] = [];
          snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InventoryTransactionLineDoc) }));
          buffers[i] = next;
          reported.add(i);
          setLines(buffers.flat());
          if (reported.size === groups.length) setLinesKey(txnIdsKey);
        },
        (err) => {
          setError(getFirestoreUserMessage(err));
          setLinesKey(txnIdsKey);
        },
      ),
    );

    return () => unsubs.forEach((unsub) => unsub());
  }, [txnIdsKey]);

  // No transactions means there are no lines to wait for.
  const linesReady = transactions.length === 0 || linesKey === txnIdsKey;
  const loading = !transactionsLoaded || !linesReady;

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
