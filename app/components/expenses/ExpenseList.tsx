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
import type { ExpenseDoc } from "@/lib/types/firestore";
import { cn } from "@/lib/utils";

type Row = ExpenseDoc & { id: string };

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

export function ExpenseList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.expenses),
      orderBy("date", "desc"),
      limit(100),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setLoading(false);
        const next: Row[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as ExpenseDoc;
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
        Loading expenses…
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
        No expenses yet. Add one using the form above.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-4 py-3 font-semibold text-foreground">Date</th>
            <th className="px-4 py-3 font-semibold text-foreground">Title</th>
            <th className="px-4 py-3 font-semibold text-foreground">Amount</th>
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
              <td className="px-4 py-3 font-medium text-foreground">{row.title}</td>
              <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
