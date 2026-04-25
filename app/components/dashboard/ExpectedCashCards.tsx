"use client";

import { useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { setActualCashBalance } from "@/lib/firestore/cashSettings";
import type { CashInHandSnapshot } from "@/lib/finance/loadCashInHand";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";
import { StatCard } from "@/app/components/ui/StatCard";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";

type ExpectedCashCardsProps = {
  snapshot: CashInHandSnapshot | null;
  loading: boolean;
  onSaved: () => void;
};

function parseMoneyInput(value: string): number | null {
  const parsed = Number.parseFloat(value.trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function ExpectedCashCards({ snapshot, loading, onSaved }: ExpectedCashCardsProps) {
  const [actualInput, setActualInput] = useState("");
  const [editingActual, setEditingActual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingActual) {
      setActualInput(snapshot?.actualCashBalance !== null && snapshot?.actualCashBalance !== undefined ? String(snapshot.actualCashBalance) : "");
    }
  }, [snapshot, editingActual]);

  const variance = useMemo(() => {
    if (!snapshot || snapshot.actualCashBalance === null) return null;
    return snapshot.actualCashBalance - snapshot.expectedCashNow;
  }, [snapshot]);

  const varianceHint =
    variance === null
      ? "Set actual cash to compare against expected cash."
      : variance > 0
        ? "Actual cash is higher than expected."
        : variance < 0
          ? "Actual cash is lower than expected."
          : "Actual cash matches expected cash.";

  async function saveActualCash() {
    setError(null);
    const parsed = parseMoneyInput(actualInput);
    if (parsed === null) {
      setError("Enter a valid actual cash number.");
      return;
    }
    setSaving(true);
    try {
      await setActualCashBalance(getDb(), parsed);
      setEditingActual(false);
      onSaved();
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Expected and actual cash cards">
        {[1, 2, 3, 4, 5].map((k) => (
          <StatCard key={k} label="…" value="Loading…" />
        ))}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Expected and actual cash cards">
        <StatCard label="Operational cash" value="—" hint="No cash snapshot available." />
        <StatCard label="Loan cash impact" value="—" hint="No cash snapshot available." />
        <StatCard label="Expected cash now" value="—" hint="No cash snapshot available." />
        <StatCard label="Actual cash today" value="—" hint="No cash snapshot available." />
        <StatCard label="Difference (actual - expected)" value="—" hint="No cash snapshot available." />
      </div>
    );
  }

  return (
    <section aria-labelledby="expected-cash-cards" className="space-y-4">
      <div>
        <h2 id="expected-cash-cards" className="text-base font-semibold text-foreground">
          Expected vs actual cash
        </h2>
        <p className="text-sm text-muted-foreground">
          Expected cash is all-time liquid cash estimate from recorded flows. Compare it with your real bank + cash amount.
        </p>
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Expected and actual cash cards">
        <StatCard
          label="Operational cash"
          value={formatMoney(snapshot.operationalCash)}
          hint="Opening + cash sales + invoice collections - expenses - stock-in cash."
        />
        <StatCard
          label="Loan cash impact"
          value={formatMoney(snapshot.loanCashImpact)}
          hint="Money borrowed - partner repayments."
        />
        <StatCard
          label="Expected cash now"
          value={formatMoney(snapshot.expectedCashNow)}
          hint="Operational cash + loan cash impact."
        />
        <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual cash today</p>
          <p className="mt-2 tabular-nums text-2xl font-semibold tracking-tight text-foreground">
            {snapshot.actualCashBalance !== null ? formatMoney(snapshot.actualCashBalance) : "Not set"}
          </p>
          {editingActual ? (
            <div className="mt-3 space-y-2">
              <Input
                type="text"
                inputMode="decimal"
                value={actualInput}
                onChange={(e) => setActualInput(e.target.value)}
                placeholder="Enter actual cash"
                aria-label="Actual cash today"
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={saving} onClick={() => setEditingActual(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={saving} onClick={() => void saveActualCash()}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <Button type="button" variant="outline" onClick={() => setEditingActual(true)}>
                {snapshot.actualCashBalance !== null ? "Update actual cash" : "Set actual cash"}
              </Button>
            </div>
          )}
        </div>
        <StatCard
          label="Difference (actual - expected)"
          value={variance !== null ? formatMoney(variance) : "—"}
          hint={varianceHint}
        />
      </div>
    </section>
  );
}
