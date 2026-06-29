"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { computeLoanBalances, type PartyLoanBalance } from "@/lib/finance/loanBalances";
import type { CashEntryDoc, LoanEntryKind } from "@/lib/types/firestore";
import { AddCashEntryModal } from "@/app/components/cash/AddCashEntryModal";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { cn } from "@/lib/utils";

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type Prefill = {
  loanKind: LoanEntryKind;
  partyId: string;
  partyName: string;
};

export function LoanBalancesTable() {
  const [entries, setEntries] = useState<CashEntryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(getDb(), COLLECTIONS.cashEntries),
      (snap) => {
        setLoading(false);
        setError(null);
        const next: CashEntryDoc[] = [];
        snap.forEach((d) => next.push(d.data() as CashEntryDoc));
        setEntries(next);
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  const result = useMemo(() => computeLoanBalances(entries), [entries]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading loan balances…</p>;
  }

  return (
    <div className="space-y-4">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      {result.parties.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No loans recorded yet. Use “Add loan entry” to record money you borrowed or lent.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[920px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-3 font-semibold text-foreground">Party</th>
                <th className="px-4 py-3 font-semibold text-foreground text-right">You owe</th>
                <th className="px-4 py-3 font-semibold text-foreground text-right">Owed to you</th>
                <th className="px-4 py-3 font-semibold text-foreground text-right">Net</th>
                <th className="px-4 py-3 font-semibold text-foreground">Status</th>
                <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.parties.map((p, i) => (
                <LoanRow key={p.partyId} party={p} striped={i % 2 === 1} onPrefill={setPrefill} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {prefill ? (
        <AddCashEntryModal
          initialMode="loan"
          lockMode
          initialLoanKind={prefill.loanKind}
          initialPartyId={prefill.partyId}
          initialPartyName={prefill.partyName}
          onDismiss={() => setPrefill(null)}
        />
      ) : null}
    </div>
  );
}

function LoanRow({
  party,
  striped,
  onPrefill,
}: {
  party: PartyLoanBalance;
  striped: boolean;
  onPrefill: (p: Prefill) => void;
}) {
  const net = party.net;
  const status =
    net > 0 ? "They owe you" : net < 0 ? "You owe them" : "Settled";

  return (
    <tr
      className={cn(
        "border-b border-border last:border-b-0",
        striped ? "bg-surface-muted/50" : "bg-surface",
      )}
    >
      <td className="px-4 py-3 font-medium text-foreground">{party.partyName}</td>
      <td className="px-4 py-3 text-right tabular-nums text-destructive">
        {party.youOwe > 0 ? money(party.youOwe) : "—"}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-success">
        {party.owedToYou > 0 ? money(party.owedToYou) : "—"}
      </td>
      <td
        className={cn(
          "px-4 py-3 text-right tabular-nums font-medium",
          net > 0 ? "text-success" : net < 0 ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {net === 0 ? "0" : `${net > 0 ? "+" : "−"}${money(Math.abs(net))}`}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            net > 0
              ? "bg-success-muted text-success"
              : net < 0
                ? "bg-destructive-muted text-destructive"
                : "bg-surface-hover text-muted-foreground",
          )}
        >
          {status}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {party.youOwe > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onPrefill({ loanKind: "repaid", partyId: party.partyId, partyName: party.partyName })
              }
            >
              Record repayment
            </Button>
          ) : null}
          {party.owedToYou > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onPrefill({
                  loanKind: "collected",
                  partyId: party.partyId,
                  partyName: party.partyName,
                })
              }
            >
              Record collection
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
