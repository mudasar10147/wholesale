"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  getInvoiceAmountDue,
  getInvoiceEffectiveTotal,
} from "@/lib/invoices/invoiceEffective";
import type { CustomerDoc, InvoiceDoc } from "@/lib/types/firestore";
import { StatCard } from "@/app/components/ui/StatCard";

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function CustomerKpiCards() {
  const [customers, setCustomers] = useState<Array<CustomerDoc & { id: string }>>([]);
  const [invoices, setInvoices] = useState<Array<InvoiceDoc & { id: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(getDb(), COLLECTIONS.customers),
      (snap) => {
        setLoading(false);
        const next: Array<CustomerDoc & { id: string }> = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as CustomerDoc) }));
        setCustomers(next);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(getDb(), COLLECTIONS.invoices), (snap) => {
      const next: Array<InvoiceDoc & { id: string }> = [];
      snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InvoiceDoc) }));
      setInvoices(next);
    });
    return () => unsub();
  }, []);

  const kpis = useMemo(() => {
    const activeCustomers = customers.filter((c) => c.is_active !== false).length;

    const invoicedCustomerIds = new Set<string>();
    let revenue = 0;
    let outstanding = 0;
    for (const inv of invoices) {
      if (inv.status === "void") continue;
      if (inv.customer_id) invoicedCustomerIds.add(inv.customer_id);
      if (inv.status === "posted") {
        revenue += getInvoiceEffectiveTotal(inv);
        outstanding += getInvoiceAmountDue(inv);
      }
    }

    return {
      activeCustomers,
      invoicedCustomers: invoicedCustomerIds.size,
      revenue,
      outstanding,
    };
  }, [customers, invoices]);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-xl border border-border bg-surface-muted/40" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Active customers" value={kpis.activeCustomers.toLocaleString()} />
      <StatCard
        label="Customers invoiced"
        value={kpis.invoicedCustomers.toLocaleString()}
        hint="With at least one non-void invoice"
      />
      <StatCard label="Revenue" value={money(kpis.revenue)} hint="Posted invoices, net of returns" />
      <StatCard
        label="Outstanding due"
        value={money(kpis.outstanding)}
        hint="Unpaid balance on posted invoices"
      />
    </div>
  );
}
