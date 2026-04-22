"use client";

import { useEffect, useMemo, useState } from "react";
import type { Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  fetchProductNamesByIds,
  fetchSalesDocsInRange,
  type SaleDocRow,
} from "@/lib/firestore/salesDrilldown";
import type { SaleDoc } from "@/lib/types/firestore";
import { sumSaleAmounts } from "@/lib/profit/metrics";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";

type ProductSummary = {
  productId: string;
  name: string;
  totalQty: number;
  subtotal: number;
  lineCount: number;
};

function formatTs(ts: Timestamp | undefined): string {
  if (!ts?.toDate) return "—";
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

function refLine(s: SaleDoc): string {
  const parts: string[] = [];
  if (s.invoice_id) parts.push(`inv:${s.invoice_id}`);
  if (s.walk_in_session_id) parts.push(`walk-in:${s.walk_in_session_id}`);
  if (s.order_id) parts.push(`order:${s.order_id}`);
  if (s.customer_id) parts.push(`cust:${s.customer_id}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export type SalesDrilldownModalProps = {
  open: boolean;
  onClose: () => void;
  start: Date;
  end: Date;
  periodTitle: string;
  kpiTotalSales: number;
};

export function SalesDrilldownModal({
  open,
  onClose,
  start,
  end,
  periodTitle,
  kpiTotalSales,
}: SalesDrilldownModalProps) {
  const [rows, setRows] = useState<SaleDocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setLoadError(null);
      try {
        const db = getDb();
        const saleRows = await fetchSalesDocsInRange(db, start, end);
        if (cancelled) return;
        setRows(saleRows);
      } catch (e) {
        if (!cancelled) setLoadError(getFirestoreUserMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, start, end]);

  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!open || rows.length === 0) {
      setNameMap(new Map());
      return;
    }
    let cancelled = false;
    async function run() {
      try {
        const db = getDb();
        const ids = rows.map((r) => r.data.product_id);
        const map = await fetchProductNamesByIds(db, ids);
        if (!cancelled) setNameMap(map);
      } catch {
        if (!cancelled) setNameMap(new Map());
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, rows]);

  const computedTotal = useMemo(() => sumSaleAmounts(rows.map((r) => r.data)), [rows]);

  const byProduct = useMemo((): ProductSummary[] => {
    const m = new Map<string, ProductSummary>();
    for (const r of rows) {
      const s = r.data;
      const pid = s.product_id;
      const name = nameMap.get(pid) ?? "(loading…)";
      const qty = typeof s.quantity === "number" ? s.quantity : 0;
      const amt = typeof s.total_amount === "number" ? s.total_amount : 0;
      const cur = m.get(pid);
      if (cur) {
        cur.totalQty += qty;
        cur.subtotal += amt;
        cur.lineCount += 1;
        cur.name = name;
      } else {
        m.set(pid, {
          productId: pid,
          name,
          totalQty: qty,
          subtotal: amt,
          lineCount: 1,
        });
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, nameMap]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ta = a.data.date?.toMillis?.() ?? 0;
      const tb = b.data.date?.toMillis?.() ?? 0;
      return ta - tb;
    });
  }, [rows]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const boundsText = `${start.toLocaleString()} → ${end.toLocaleString()} (local)`;
  const delta = Math.round((computedTotal - kpiTotalSales) * 100) / 100;
  const totalsMatch = Math.abs(computedTotal - kpiTotalSales) < 0.005;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="sales-drill-title"
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="sales-drill-title" className="text-lg font-semibold text-foreground">
              Sales detail
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{periodTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground font-mono">{boundsText}</p>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        {loadError ? (
          <InlineAlert variant="error" className="mt-4">
            {loadError}
          </InlineAlert>
        ) : null}

        {loading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading sales…</p>
        ) : null}

        {!loading && !loadError ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border bg-surface-muted p-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">KPI total sales</p>
                <p className="mt-1 tabular-nums text-lg font-semibold">{formatMoney(kpiTotalSales)}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted p-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">Sum of sale rows</p>
                <p className="mt-1 tabular-nums text-lg font-semibold">{formatMoney(computedTotal)}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted p-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">Difference</p>
                <p className="mt-1 tabular-nums text-lg font-semibold">
                  {totalsMatch ? "0" : formatMoney(delta)}
                </p>
              </div>
            </div>
            {!totalsMatch ? (
              <InlineAlert variant="info" className="mt-3 text-sm">
                KPI and row sum should match. If they do not, refresh the dashboard or check for
                concurrent edits.
              </InlineAlert>
            ) : null}

            <div className="mt-6 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">By product</h3>
              {byProduct.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales in this period.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-muted">
                        <th className="px-3 py-2 font-semibold">Product</th>
                        <th className="px-3 py-2 font-semibold">Qty</th>
                        <th className="px-3 py-2 font-semibold">Lines</th>
                        <th className="px-3 py-2 font-semibold text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byProduct.map((p) => (
                        <tr key={p.productId} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-2">
                            <span className="font-medium">{p.name}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">{p.productId}</span>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{p.totalQty.toLocaleString()}</td>
                          <td className="px-3 py-2 tabular-nums">{p.lineCount}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <details className="mt-6 rounded-md border border-border bg-surface-muted/40 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">
                Raw sale documents ({sortedRows.length})
              </summary>
              <div className="mt-3 overflow-x-auto rounded-md border border-border bg-surface">
                <table className="w-full min-w-[960px] border-collapse text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted">
                      <th className="px-2 py-2 font-semibold">Sale id</th>
                      <th className="px-2 py-2 font-semibold">Date</th>
                      <th className="px-2 py-2 font-semibold">Product</th>
                      <th className="px-2 py-2 font-semibold">Qty</th>
                      <th className="px-2 py-2 font-semibold">Unit</th>
                      <th className="px-2 py-2 font-semibold text-right">Total</th>
                      <th className="px-2 py-2 font-semibold">Refs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => {
                      const s = r.data;
                      const name = nameMap.get(s.product_id) ?? "—";
                      return (
                        <tr key={r.id} className="border-b border-border last:border-b-0">
                          <td className="px-2 py-2 font-mono text-muted-foreground">{r.id}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{formatTs(s.date)}</td>
                          <td className="px-2 py-2">
                            <span className="font-medium">{name}</span>
                            <span className="ml-1 font-mono text-muted-foreground">{s.product_id}</span>
                          </td>
                          <td className="px-2 py-2 tabular-nums">{s.quantity}</td>
                          <td className="px-2 py-2 tabular-nums">{formatMoney(s.sale_price)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatMoney(s.total_amount)}</td>
                          <td className="px-2 py-2 text-muted-foreground">{refLine(s)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : null}
      </div>
    </div>
  );
}
