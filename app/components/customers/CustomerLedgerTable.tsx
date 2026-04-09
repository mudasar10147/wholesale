"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CustomerDoc, InvoiceDoc } from "@/lib/types/firestore";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { cn } from "@/lib/utils";

type CustomerRow = CustomerDoc & { id: string };
type InvoiceRow = InvoiceDoc & { id: string };

type LedgerRow = {
  customer_id: string;
  customer_name: string;
  total_purchased: number;
  paid_amount: number;
  unpaid_amount: number;
  total_discount: number;
  delivery_charges: number;
  net_revenue_contribution: number;
};

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function CustomerLedgerTable() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      query(collection(db, COLLECTIONS.customers), orderBy("created_at", "desc")),
      (snap) => {
        setLoadingCustomers(false);
        setError(null);
        const next: CustomerRow[] = [];
        snap.forEach((docSnap) => {
          next.push({ id: docSnap.id, ...(docSnap.data() as CustomerDoc) });
        });
        setCustomers(next);
      },
      (err) => {
        setLoadingCustomers(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      query(collection(db, COLLECTIONS.invoices), orderBy("created_at", "desc")),
      (snap) => {
        setLoadingInvoices(false);
        setError(null);
        const next: InvoiceRow[] = [];
        snap.forEach((docSnap) => {
          next.push({ id: docSnap.id, ...(docSnap.data() as InvoiceDoc) });
        });
        setInvoices(next);
      },
      (err) => {
        setLoadingInvoices(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  const rows = useMemo<LedgerRow[]>(() => {
    const byCustomer = new Map<string, LedgerRow>();
    const customerName = new Map(customers.map((c) => [c.id, c.name]));

    for (const inv of invoices) {
      if (inv.status === "void") continue;
      const customerId = inv.customer_id;
      if (!customerId) continue;

      const row =
        byCustomer.get(customerId) ??
        ({
          customer_id: customerId,
          customer_name: customerName.get(customerId) ?? "Unknown customer",
          total_purchased: 0,
          paid_amount: 0,
          unpaid_amount: 0,
          total_discount: 0,
          delivery_charges: 0,
          net_revenue_contribution: 0,
        } satisfies LedgerRow);

      const total = inv.posted_total_amount ?? inv.total_amount ?? 0;
      const discount = inv.posted_discount_amount ?? inv.discount_amount ?? 0;
      const delivery = inv.posted_delivery_charge ?? inv.delivery_charge ?? 0;
      const paidRaw = typeof inv.paid_amount === "number" ? inv.paid_amount : 0;
      const paid = Math.min(Math.max(0, paidRaw), Math.max(0, total));
      const unpaid = Math.max(0, total - paid);

      row.total_purchased += total;
      row.paid_amount += paid;
      row.unpaid_amount += unpaid;
      row.total_discount += discount;
      row.delivery_charges += delivery;
      row.net_revenue_contribution += total;

      byCustomer.set(customerId, row);
    }

    const all = Array.from(byCustomer.values());
    all.sort((a, b) => b.net_revenue_contribution - a.net_revenue_contribution);
    return all;
  }, [customers, invoices]);

  if (loadingCustomers || loadingInvoices) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading customer ledger…
      </p>
    );
  }

  if (error) {
    return <InlineAlert variant="error">{error}</InlineAlert>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No invoice activity yet. Post invoices to populate customer ledger analytics.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-4 py-3 font-semibold text-foreground">Customer</th>
            <th className="px-4 py-3 font-semibold text-foreground">Total purchased</th>
            <th className="px-4 py-3 font-semibold text-foreground">Paid amount</th>
            <th className="px-4 py-3 font-semibold text-foreground">Unpaid amount</th>
            <th className="px-4 py-3 font-semibold text-foreground">Total discount</th>
            <th className="px-4 py-3 font-semibold text-foreground">Delivery charges</th>
            <th className="px-4 py-3 font-semibold text-foreground">Net revenue contribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.customer_id}
              className={cn(
                "border-b border-border last:border-b-0",
                i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
              )}
            >
              <td className="px-4 py-3 font-medium text-foreground">{row.customer_name}</td>
              <td className="px-4 py-3 tabular-nums text-foreground">{money(row.total_purchased)}</td>
              <td className="px-4 py-3 tabular-nums text-success">{money(row.paid_amount)}</td>
              <td className="px-4 py-3 tabular-nums text-destructive">{money(row.unpaid_amount)}</td>
              <td className="px-4 py-3 tabular-nums text-foreground">{money(row.total_discount)}</td>
              <td className="px-4 py-3 tabular-nums text-foreground">{money(row.delivery_charges)}</td>
              <td className="px-4 py-3 tabular-nums font-medium text-foreground">
                {money(row.net_revenue_contribution)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
