"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { summarizePartnerLoans } from "@/lib/finance/partnerLoans";
import type { PartnerLoanDoc } from "@/lib/types/firestore";
import { cn } from "@/lib/utils";

type Row = PartnerLoanDoc & { id: string };

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(ts: Timestamp) {
  try {
    return ts.toDate().toLocaleDateString();
  } catch {
    return "-";
  }
}

export function PartnerLoanLedgerTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const q = query(collection(db, COLLECTIONS.partnerLoans), orderBy("date", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoading(false);
        setError(null);
        const next: Row[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as PartnerLoanDoc) }));
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  const summary = useMemo(() => summarizePartnerLoans(rows), [rows]);
  const runningByPartner = useMemo(() => {
    const m = new Map<string, number>();
    return rows.map((row) => {
      const prev = m.get(row.partner_name) ?? 0;
      const next =
        prev +
        (row.entry_type === "loan_in" || row.entry_type === "loan_given_return"
          ? row.amount
          : -row.amount);
      m.set(row.partner_name, next);
      return { id: row.id, pending: next };
    });
  }, [rows]);
  const runningById = useMemo(
    () => new Map(runningByPartner.map((r) => [r.id, r.pending])),
    [runningByPartner],
  );

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading loan ledger...
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No partner loan entries yet. Add one using the form above.
      </p>
    );
  }

  const partnerSplits = [...summary.pendingByPartner.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-muted-foreground">
          Borrowed in:{" "}
          <strong className="tabular-nums font-semibold text-foreground">
            {formatMoney(summary.borrowedIn)}
          </strong>
        </span>
        <span className="text-muted-foreground">
          Borrowed repaid:{" "}
          <strong className="tabular-nums font-semibold text-foreground">
            {formatMoney(summary.borrowedRepaidOut)}
          </strong>
        </span>
        <span className="text-muted-foreground">
          Loan given out:{" "}
          <strong className="tabular-nums font-semibold text-foreground">
            {formatMoney(summary.givenOut)}
          </strong>
        </span>
        <span className="text-muted-foreground">
          Loan given returned:{" "}
          <strong className="tabular-nums font-semibold text-foreground">
            {formatMoney(summary.givenReturnedIn)}
          </strong>
        </span>
        <span className="text-muted-foreground">
          Net loan impact:{" "}
          <strong className="tabular-nums font-semibold text-foreground">
            {formatMoney(summary.pendingTotal)}
          </strong>
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {partnerSplits.map(([partner, pending]) => (
          <span key={partner} className="mr-3 inline-block">
            {partner}: <span className="tabular-nums">{formatMoney(pending)}</span>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-4 py-3 font-semibold text-foreground">Date</th>
              <th className="px-4 py-3 font-semibold text-foreground">Partner</th>
              <th className="px-4 py-3 font-semibold text-foreground">Type</th>
              <th className="px-4 py-3 font-semibold text-foreground">Amount</th>
              <th className="px-4 py-3 font-semibold text-foreground">Running pending</th>
              <th className="px-4 py-3 font-semibold text-foreground">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const signed =
                row.entry_type === "loan_in" || row.entry_type === "loan_given_return"
                  ? row.amount
                  : -row.amount;
              const pending = runningById.get(row.id) ?? 0;
              const typeLabel =
                row.entry_type === "loan_in"
                  ? "Loan in"
                  : row.entry_type === "repayment"
                    ? "Repayment"
                    : row.entry_type === "loan_given"
                      ? "Loan given"
                      : "Loan given return";
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                  )}
                >
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(row.date)}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{row.partner_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {typeLabel}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 tabular-nums",
                      signed >= 0 ? "text-foreground" : "text-destructive",
                    )}
                  >
                    {signed >= 0 ? "+" : ""}
                    {formatMoney(signed)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(pending)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.note ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
