"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  aggregatePurchasesByDay,
  aggregatePurchasesByMonth,
  aggregatePurchasesByWeek,
  aggregateStockInByProductForPeriod,
  computePurchaseKpis,
  filterStockInLotsInPeriod,
  type PurchaseAggregateRow,
  type StockInPeriodType,
} from "@/lib/inventory/purchaseReports";
import {
  formatCalendarWeekLabel,
  getCalendarWeekBounds,
  getCurrentMonthBounds,
  getTodayBounds,
} from "@/lib/profit/periods";
import type { ProductDoc, StockLotDoc } from "@/lib/types/firestore";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { StatCard } from "@/app/components/ui/StatCard";
import { cn } from "@/lib/utils";

type LotRow = StockLotDoc & { id: string };
type ProductRow = ProductDoc & { id: string };

type BreakdownView = StockInPeriodType;

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function kpiHint(kpis: { totalQty: number; totalValue: number; receiptCount: number }): string {
  return `${kpis.totalQty.toLocaleString()} units · ${money(kpis.totalValue)} value · ${kpis.receiptCount} receipt${kpis.receiptCount === 1 ? "" : "s"}`;
}

function BreakdownTable({
  rows,
  lots,
  periodType,
  productNameById,
  emptyMessage,
}: {
  rows: PurchaseAggregateRow[];
  lots: LotRow[];
  periodType: BreakdownView;
  productNameById: Map<string, string>;
  emptyMessage: string;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    setExpandedKey(null);
  }, [periodType]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  function toggleRow(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[420px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-3 py-2 font-semibold">Period</th>
            <th className="px-3 py-2 font-semibold text-right">Units</th>
            <th className="px-3 py-2 font-semibold text-right">Value</th>
            <th className="px-3 py-2 font-semibold text-right">Receipts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isExpanded = expandedKey === row.key;
            const productLines = isExpanded
              ? aggregateStockInByProductForPeriod(lots, row.key, periodType)
              : [];

            return (
              <Fragment key={row.key}>
                <tr className="border-b border-border">
                  <td className="px-3 py-2 text-foreground">
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 text-left",
                        "rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                      aria-expanded={isExpanded}
                      onClick={() => toggleRow(row.key)}
                    >
                      <span
                        className={cn(
                          "inline-block text-xs text-muted-foreground transition-transform",
                          isExpanded && "rotate-90",
                        )}
                        aria-hidden
                      >
                        ▶
                      </span>
                      <span>{row.label}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.totalQty.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(row.totalValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.receiptCount.toLocaleString()}</td>
                </tr>
                {isExpanded ? (
                  <tr className="border-b border-border bg-surface-muted/40">
                    <td colSpan={4} className="px-3 py-3">
                      {productLines.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No product lines for this period.</p>
                      ) : (
                        <ul className="space-y-1.5 pl-5">
                          {productLines.map((line) => (
                            <li
                              key={line.productId}
                              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs"
                            >
                              <span className="font-medium text-foreground">
                                {productNameById.get(line.productId) ?? line.productId}
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {line.totalQty.toLocaleString()} unit{line.totalQty === 1 ? "" : "s"}
                                {" · "}
                                {money(line.totalValue)}
                                {line.receiptCount > 1
                                  ? ` · ${line.receiptCount} receipts`
                                  : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const VIEW_OPTIONS: { value: BreakdownView; label: string }[] = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
];

export function ProductStockInSummary() {
  const [lots, setLots] = useState<LotRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<BreakdownView>("day");

  useEffect(() => {
    const db = getDb();
    let done = 0;
    const markDone = () => {
      done += 1;
      if (done >= 2) setLoading(false);
    };

    const unsubLots = onSnapshot(
      query(collection(db, COLLECTIONS.stockLots)),
      (snap) => {
        setError(null);
        const next: LotRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as StockLotDoc) }));
        setLots(next);
        markDone();
      },
      (err) => {
        setError(getFirestoreUserMessage(err));
        setLoading(false);
      },
    );

    const unsubProducts = onSnapshot(
      query(collection(db, COLLECTIONS.products)),
      (snap) => {
        const next: ProductRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as ProductDoc) }));
        setProducts(next);
        markDone();
      },
      (err) => {
        setError(getFirestoreUserMessage(err));
        setLoading(false);
      },
    );

    return () => {
      unsubLots();
      unsubProducts();
    };
  }, []);

  const productNameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.name])),
    [products],
  );

  const now = useMemo(() => new Date(), [lots]);

  const todayKpis = useMemo(() => {
    const { start, end } = getTodayBounds(now);
    return computePurchaseKpis(filterStockInLotsInPeriod(lots, start, end));
  }, [lots, now]);

  const weekKpis = useMemo(() => {
    const { start, end } = getCalendarWeekBounds(now);
    return computePurchaseKpis(filterStockInLotsInPeriod(lots, start, end));
  }, [lots, now]);

  const monthKpis = useMemo(() => {
    const { start, end } = getCurrentMonthBounds(now);
    return computePurchaseKpis(filterStockInLotsInPeriod(lots, start, end));
  }, [lots, now]);

  const weekLabel = useMemo(() => {
    const { start, end } = getCalendarWeekBounds(now);
    return formatCalendarWeekLabel(start, end);
  }, [now]);

  const monthLabel = useMemo(
    () =>
      now.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
    [now],
  );

  const breakdownRows = useMemo(() => {
    const limit = view === "day" ? 14 : view === "week" ? 8 : 6;
    if (view === "day") return aggregatePurchasesByDay(lots).slice(0, limit);
    if (view === "week") return aggregatePurchasesByWeek(lots).slice(0, limit);
    return aggregatePurchasesByMonth(lots).slice(0, limit);
  }, [lots, view]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading stock-in activity…</p>;
  }

  if (error) {
    return (
      <InlineAlert variant="error" className="max-w-lg">
        {error}
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Totals from stock-in receipts only. Click a period row to see which products were added.
        </p>
        <Link
          href="/reports/purchases"
          className="text-sm font-medium text-primary hover:underline"
        >
          Full purchase report
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Stock in today"
          value={`${todayKpis.totalQty.toLocaleString()} units`}
          hint={kpiHint(todayKpis)}
        />
        <StatCard
          label="This week"
          value={`${weekKpis.totalQty.toLocaleString()} units`}
          hint={
            <>
              <span className="block">{weekLabel}</span>
              <span className="block">{kpiHint(weekKpis)}</span>
            </>
          }
        />
        <StatCard
          label="This month"
          value={`${monthKpis.totalQty.toLocaleString()} units`}
          hint={
            <>
              <span className="block">{monthLabel}</span>
              <span className="block">{kpiHint(monthKpis)}</span>
            </>
          }
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">Stock-in history</h3>
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-muted p-1">
            {VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  view === opt.value
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setView(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <BreakdownTable
          rows={breakdownRows}
          lots={lots}
          periodType={view}
          productNameById={productNameById}
          emptyMessage="No stock-in receipts yet. Stock in a product to see activity here."
        />
      </div>
    </div>
  );
}
