"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type {
  CustomerDoc,
  InvoiceDoc,
  InvoiceItemCogsDoc,
  ProductDoc,
  StockLotDoc,
} from "@/lib/types/firestore";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { cn } from "@/lib/utils";

type ProductRow = ProductDoc & { id: string };
type LotRow = StockLotDoc & { id: string };
type InvoiceRow = InvoiceDoc & { id: string };
type CustomerRow = CustomerDoc & { id: string };
type CogsRow = InvoiceItemCogsDoc & { id: string };

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function ageDays(ts: Timestamp): number {
  return Math.max(0, Math.floor((Date.now() - ts.toDate().getTime()) / (1000 * 60 * 60 * 24)));
}

export function FifoAuditReport() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [itemCogs, setItemCogs] = useState<CogsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    let done = 0;
    const total = 5;
    const markDone = () => {
      done += 1;
      if (done >= total) setLoading(false);
    };

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
    const unsubLots = onSnapshot(
      query(collection(db, COLLECTIONS.stockLots)),
      (snap) => {
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
    const unsubInvoices = onSnapshot(
      query(collection(db, COLLECTIONS.invoices)),
      (snap) => {
        const next: InvoiceRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InvoiceDoc) }));
        setInvoices(next);
        markDone();
      },
      (err) => {
        setError(getFirestoreUserMessage(err));
        setLoading(false);
      },
    );
    const unsubCustomers = onSnapshot(
      query(collection(db, COLLECTIONS.customers)),
      (snap) => {
        const next: CustomerRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as CustomerDoc) }));
        setCustomers(next);
        markDone();
      },
      (err) => {
        setError(getFirestoreUserMessage(err));
        setLoading(false);
      },
    );
    const unsubCogs = onSnapshot(
      query(collection(db, COLLECTIONS.invoiceItemCogs)),
      (snap) => {
        const next: CogsRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InvoiceItemCogsDoc) }));
        setItemCogs(next);
        markDone();
      },
      (err) => {
        setError(getFirestoreUserMessage(err));
        setLoading(false);
      },
    );

    return () => {
      unsubProducts();
      unsubLots();
      unsubInvoices();
      unsubCustomers();
      unsubCogs();
    };
  }, []);

  const productName = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const customerName = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);

  const lotAging = useMemo(() => {
    const rows = lots
      .filter((l) => (l.qty_remaining ?? 0) > 0)
      .map((l) => {
        const rem = l.qty_remaining ?? 0;
        const cost = l.unit_cost ?? 0;
        return {
          id: l.id,
          product: productName.get(l.product_id) ?? l.product_id,
          source: l.source,
          qtyRemaining: rem,
          unitCost: cost,
          value: rem * cost,
          daysOld: ageDays(l.received_at),
        };
      })
      .sort((a, b) => b.daysOld - a.daysOld);
    return rows;
  }, [lots, productName]);

  const stockValuation = useMemo(() => {
    const lotQty = new Map<string, number>();
    const lotValue = new Map<string, number>();
    for (const lot of lots) {
      const qty = typeof lot.qty_remaining === "number" ? lot.qty_remaining : 0;
      const value = qty * (typeof lot.unit_cost === "number" ? lot.unit_cost : 0);
      lotQty.set(lot.product_id, (lotQty.get(lot.product_id) ?? 0) + qty);
      lotValue.set(lot.product_id, (lotValue.get(lot.product_id) ?? 0) + value);
    }
    return products
      .map((p) => {
        const lq = lotQty.get(p.id) ?? 0;
        const lv = lotValue.get(p.id) ?? 0;
        return {
          productId: p.id,
          productName: p.name,
          stockQty: p.stock_quantity ?? 0,
          lotQty: lq,
          lotValue: lv,
          avgCost: lq > 0 ? lv / lq : 0,
        };
      })
      .sort((a, b) => b.lotValue - a.lotValue);
  }, [lots, products]);

  const invoiceMargin = useMemo(() => {
    const cogsByInvoice = new Map<string, number>();
    for (const row of itemCogs) {
      cogsByInvoice.set(row.invoice_id, (cogsByInvoice.get(row.invoice_id) ?? 0) + (row.cogs_amount ?? 0));
    }
    return invoices
      .filter((inv) => inv.status === "posted")
      .map((inv) => {
        const revenue = inv.posted_total_amount ?? inv.total_amount ?? 0;
        const cogs = cogsByInvoice.get(inv.id) ?? 0;
        return {
          invoiceId: inv.id,
          orderId: inv.order_id,
          customer: customerName.get(inv.customer_id) ?? inv.customer_id,
          revenue,
          cogs,
          grossMargin: revenue - cogs,
          marginPct: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [invoices, itemCogs, customerName]);

  const reconciliation = useMemo(() => {
    const checks: Array<{ severity: "error" | "warning"; message: string }> = [];

    for (const row of stockValuation) {
      if (row.stockQty !== row.lotQty) {
        checks.push({
          severity: "error",
          message: `${row.productName}: product stock ${row.stockQty} != lot stock ${row.lotQty}`,
        });
      }
      if (row.lotQty < 0 || row.stockQty < 0) {
        checks.push({
          severity: "error",
          message: `${row.productName}: negative stock detected`,
        });
      }
    }

    const cogsByInvoice = new Map<string, number>();
    for (const row of itemCogs) {
      cogsByInvoice.set(row.invoice_id, (cogsByInvoice.get(row.invoice_id) ?? 0) + (row.cogs_amount ?? 0));
    }
    for (const inv of invoices) {
      if (inv.status !== "posted") continue;
      const expected = inv.posted_cogs_amount ?? 0;
      const actual = cogsByInvoice.get(inv.id) ?? 0;
      if (Math.abs(expected - actual) > 0.01) {
        checks.push({
          severity: "warning",
          message: `${inv.order_id}: posted COGS ${money(expected)} != line COGS ${money(actual)}`,
        });
      }
    }

    if (checks.length === 0) {
      checks.push({ severity: "warning", message: "No reconciliation issues found." });
    }
    return checks;
  }, [stockValuation, itemCogs, invoices]);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading FIFO reports…
      </p>
    );
  }
  if (error) return <InlineAlert variant="error">{error}</InlineAlert>;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Reconciliation checks</h3>
        <div className="space-y-2">
          {reconciliation.map((c, i) => (
            <InlineAlert key={`${c.severity}-${i}`} variant={c.severity === "error" ? "error" : "info"}>
              {c.message}
            </InlineAlert>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Lot aging</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-3 font-semibold text-foreground">Product</th>
                <th className="px-4 py-3 font-semibold text-foreground">Source</th>
                <th className="px-4 py-3 font-semibold text-foreground">Days old</th>
                <th className="px-4 py-3 font-semibold text-foreground">Qty remaining</th>
                <th className="px-4 py-3 font-semibold text-foreground">Unit cost</th>
                <th className="px-4 py-3 font-semibold text-foreground">Remaining value</th>
              </tr>
            </thead>
            <tbody>
              {lotAging.map((r, i) => (
                <tr
                  key={r.id}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                  )}
                >
                  <td className="px-4 py-3 text-foreground">{r.product}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.source}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{r.daysOld}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{r.qtyRemaining}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{money(r.unitCost)}</td>
                  <td className="px-4 py-3 tabular-nums font-medium text-foreground">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Remaining stock valuation</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-3 font-semibold text-foreground">Product</th>
                <th className="px-4 py-3 font-semibold text-foreground">Product stock</th>
                <th className="px-4 py-3 font-semibold text-foreground">Lot stock</th>
                <th className="px-4 py-3 font-semibold text-foreground">Avg lot cost</th>
                <th className="px-4 py-3 font-semibold text-foreground">Lot valuation</th>
              </tr>
            </thead>
            <tbody>
              {stockValuation.map((r, i) => (
                <tr
                  key={r.productId}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                  )}
                >
                  <td className="px-4 py-3 text-foreground">{r.productName}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{r.stockQty}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{r.lotQty}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{money(r.avgCost)}</td>
                  <td className="px-4 py-3 tabular-nums font-medium text-foreground">{money(r.lotValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Per-invoice gross margin</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-3 font-semibold text-foreground">Order ID</th>
                <th className="px-4 py-3 font-semibold text-foreground">Customer</th>
                <th className="px-4 py-3 font-semibold text-foreground">Revenue</th>
                <th className="px-4 py-3 font-semibold text-foreground">COGS</th>
                <th className="px-4 py-3 font-semibold text-foreground">Gross margin</th>
                <th className="px-4 py-3 font-semibold text-foreground">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {invoiceMargin.map((r, i) => (
                <tr
                  key={r.invoiceId}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                  )}
                >
                  <td className="px-4 py-3 font-mono text-[13px] text-foreground">{r.orderId}</td>
                  <td className="px-4 py-3 text-foreground">{r.customer}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{money(r.revenue)}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{money(r.cogs)}</td>
                  <td className="px-4 py-3 tabular-nums font-medium text-foreground">{money(r.grossMargin)}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{r.marginPct.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
