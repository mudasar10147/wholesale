"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  aggregatePurchasesByDay,
  aggregatePurchasesByShop,
  computePurchaseKpis,
  filterPurchaseLotsByRange,
  type PurchaseReportRange,
} from "@/lib/inventory/purchaseReports";
import type { StockLotDoc } from "@/lib/types/firestore";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { cn } from "@/lib/utils";

type LotRow = StockLotDoc & { id: string };

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const RANGE_OPTIONS: { value: PurchaseReportRange; label: string }[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

function AggregateTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: Array<{ key: string; label: string; totalQty: number; totalValue: number; receiptCount: number }>;
  emptyMessage: string;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold text-right">Units</th>
                <th className="px-3 py-2 font-semibold text-right">Value</th>
                <th className="px-3 py-2 font-semibold text-right">Receipts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 text-foreground">{row.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.totalQty.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(row.totalValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.receiptCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PurchaseReport() {
  const [lots, setLots] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<PurchaseReportRange>("30");

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      query(collection(db, COLLECTIONS.stockLots)),
      (snap) => {
        setError(null);
        setLoading(false);
        const next: LotRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as StockLotDoc) }));
        setLots(next);
      },
      (err) => {
        setError(getFirestoreUserMessage(err));
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const filteredLots = useMemo(
    () => filterPurchaseLotsByRange(lots, range),
    [lots, range],
  );

  const kpis = useMemo(() => computePurchaseKpis(filteredLots), [filteredLots]);
  const byShop = useMemo(() => aggregatePurchasesByShop(filteredLots), [filteredLots]);
  const byDay = useMemo(() => aggregatePurchasesByDay(filteredLots), [filteredLots]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading purchase data…</p>;
  }

  if (error) {
    return (
      <InlineAlert variant="error" className="max-w-lg">
        {error}
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Stock-in receipts only. Date grouping uses each lot&apos;s received timestamp (local calendar day).
        </p>
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-muted p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                range === opt.value
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Units stocked in</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {kpis.totalQty.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Purchase value</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{money(kpis.totalValue)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Receipts</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {kpis.receiptCount.toLocaleString()}
          </p>
        </div>
      </div>

      <AggregateTable
        title="By shop"
        rows={byShop}
        emptyMessage="No stock-in receipts in this period."
      />

      <AggregateTable
        title="By day"
        rows={byDay}
        emptyMessage="No stock-in receipts in this period."
      />
    </div>
  );
}
