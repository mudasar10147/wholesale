"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CashEntryDoc } from "@/lib/types/firestore";
import { StatCard } from "@/app/components/ui/StatCard";

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function CashKpiCards() {
  const [entries, setEntries] = useState<CashEntryDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(getDb(), COLLECTIONS.cashEntries),
      (snap) => {
        setLoading(false);
        const next: CashEntryDoc[] = [];
        snap.forEach((d) => next.push(d.data() as CashEntryDoc));
        setEntries(next);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  const kpis = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    let cashIn = 0;
    let cashOut = 0;
    let monthNet = 0;
    for (const e of entries) {
      // Loans are tracked on their own page; keep general cash KPIs loan-free.
      if (e.loan_kind) continue;
      const amount = typeof e.amount === "number" && Number.isFinite(e.amount) ? e.amount : 0;
      if (amount <= 0) continue;
      const signed = e.entry_type === "add" ? amount : -amount;
      if (e.entry_type === "add") cashIn += amount;
      else if (e.entry_type === "remove") cashOut += amount;

      const t = e.date?.toDate?.().getTime?.();
      if (typeof t === "number" && t >= monthStart) monthNet += signed;
    }

    return { cashIn, cashOut, net: cashIn - cashOut, monthNet };
  }, [entries]);

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
      <StatCard label="Cash in (all time)" value={money(kpis.cashIn)} hint="Manual cash added" />
      <StatCard label="Cash out (all time)" value={money(kpis.cashOut)} hint="Manual cash removed" />
      <StatCard label="Net manual cash" value={money(kpis.net)} hint="Added − removed" />
      <StatCard label="This month (net)" value={money(kpis.monthNet)} hint="Added − removed this month" />
    </div>
  );
}
