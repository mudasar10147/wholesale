"use client";

import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProductDoc } from "@/lib/types/firestore";
import { StockAdjustControls } from "@/app/components/products/StockAdjustControls";
import { cn } from "@/lib/utils";

type Row = ProductDoc & { id: string };

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

export function ProductList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const q = query(collection(db, COLLECTIONS.products), orderBy("created_at", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setLoading(false);
        const next: Row[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as ProductDoc;
          next.push({ id: docSnap.id, ...d });
        });
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );

    return () => unsub();
  }, []);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading products…
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
        No products yet. Add one using the form above.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[960px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-4 py-3 font-semibold text-foreground">Name</th>
            <th className="px-4 py-3 font-semibold text-foreground">Category</th>
            <th className="px-4 py-3 font-semibold text-foreground">Cost</th>
            <th className="px-4 py-3 font-semibold text-foreground">Sale</th>
            <th className="px-4 py-3 font-semibold text-foreground">Stock</th>
            <th className="px-4 py-3 font-semibold text-foreground">Inventory</th>
            <th className="px-4 py-3 font-semibold text-foreground">Added</th>
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
              <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.category ?? "—"}</td>
              <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.cost_price)}</td>
              <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.sale_price)}</td>
              <td className="px-4 py-3 tabular-nums text-foreground">
                {row.stock_quantity.toLocaleString()}
              </td>
              <td className="px-4 py-3 align-top">
                <StockAdjustControls productId={row.id} currentStock={row.stock_quantity} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
