"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { computeLoanBalances } from "@/lib/finance/loanBalances";
import type { CashEntryDoc } from "@/lib/types/firestore";
import { StatCard } from "@/app/components/ui/StatCard";

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function LoanKpiCards() {
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

  const result = useMemo(() => computeLoanBalances(entries), [entries]);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-xl border border-border bg-surface-muted/40" />
        ))}
      </div>
    );
  }

  const net = result.netPosition;
  const netHint = net > 0 ? "Net owed to you" : net < 0 ? "Net you owe" : "Balanced";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="You owe (total)" value={money(result.totalYouOwe)} hint="Outstanding on money you borrowed" />
      <StatCard
        label="Owed to you (total)"
        value={money(result.totalOwedToYou)}
        hint="Outstanding on money you lent"
      />
      <StatCard label="Net loan position" value={money(net)} hint={netHint} />
      <StatCard
        label="Open loans"
        value={result.openCount.toLocaleString()}
        hint="Parties with a balance"
      />
    </div>
  );
}
