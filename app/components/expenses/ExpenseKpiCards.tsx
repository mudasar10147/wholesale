"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ExpenseDoc } from "@/lib/types/firestore";
import { StatCard } from "@/app/components/ui/StatCard";

type Row = ExpenseDoc & { id: string };

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysAgo(n: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - (n - 1));
  return d;
}

export function ExpenseKpiCards() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = getDb();
    const q = query(collection(db, COLLECTIONS.expenses), orderBy("date", "desc"), limit(1000));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoading(false);
        const next: Row[] = [];
        snap.forEach((docSnap) => next.push({ id: docSnap.id, ...(docSnap.data() as ExpenseDoc) }));
        setRows(next);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  const kpis = useMemo(() => {
    const todayStart = startOfToday().getTime();
    const monthStart = startOfMonth().getTime();
    const last30Start = daysAgo(30).getTime();

    let today = 0;
    let month = 0;
    let last30 = 0;
    let monthCount = 0;

    for (const row of rows) {
      const amount = typeof row.amount === "number" ? row.amount : 0;
      let when = 0;
      try {
        when = row.date?.toDate().getTime() ?? 0;
      } catch {
        when = 0;
      }
      if (when >= todayStart) today += amount;
      if (when >= monthStart) {
        month += amount;
        monthCount += 1;
      }
      if (when >= last30Start) last30 += amount;
    }

    return { today, month, last30, monthCount };
  }, [rows]);

  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

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
      <StatCard label="Spent today" value={money(kpis.today)} />
      <StatCard label="This month" value={money(kpis.month)} hint={monthLabel} />
      <StatCard label="Last 30 days" value={money(kpis.last30)} />
      <StatCard label="Entries this month" value={kpis.monthCount.toLocaleString()} hint={monthLabel} />
    </div>
  );
}
