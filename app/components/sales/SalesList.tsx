"use client";

import { useEffect, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { SaleDoc } from "@/lib/types/firestore";
import { cn } from "@/lib/utils";

type Row = SaleDoc & { id: string };

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(ts: Timestamp) {
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

export function SalesList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.sales),
      orderBy("date", "desc"),
      limit(50),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setLoading(false);
        const next: Row[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as SaleDoc;
          next.push({ id: docSnap.id, ...d });
        });
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setError(err.message);
      },
    );

    return () => unsub();
  }, []);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading sales…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No sales yet. Record a sale using the form above.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-4 py-3 font-semibold text-foreground">Date</th>
            <th className="px-4 py-3 font-semibold text-foreground">Product ID</th>
            <th className="px-4 py-3 font-semibold text-foreground">Qty</th>
            <th className="px-4 py-3 font-semibold text-foreground">Sale price</th>
            <th className="px-4 py-3 font-semibold text-foreground">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id}
              className={cn(
                "border-b border-border last:border-b-0",
                i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
              )}
            >
              <td className="px-4 py-3 text-muted-foreground">{formatDate(row.date)}</td>
              <td className="px-4 py-3 font-mono text-[13px] text-foreground">{row.product_id}</td>
              <td className="px-4 py-3 tabular-nums text-foreground">
                {row.quantity.toLocaleString()}
              </td>
              <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.sale_price)}</td>
              <td className="px-4 py-3 tabular-nums font-medium text-foreground">
                {formatMoney(row.total_amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
