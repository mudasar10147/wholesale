"use client";

import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { setOpeningCashBalance } from "@/lib/firestore/cashSettings";
import type { CashInHandSnapshot } from "@/lib/finance/loadCashInHand";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { MetricRow, formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";

type CashInHandCardProps = {
  snapshot: CashInHandSnapshot | null;
  loading: boolean;
  onSaved: () => void;
};

export function CashInHandCard({ snapshot, loading, onSaved }: CashInHandCardProps) {
  const [editing, setEditing] = useState(false);
  const [openingInput, setOpeningInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot && editing) {
      setOpeningInput(String(snapshot.openingBalance));
    }
  }, [snapshot, editing]);

  const startEdit = () => {
    setLocalError(null);
    setOpeningInput(snapshot !== null ? String(snapshot.openingBalance) : "0");
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setLocalError(null);
  };

  const saveOpening = async () => {
    setLocalError(null);
    const parsed = Number.parseFloat(openingInput.trim().replace(/,/g, ""));
    if (!Number.isFinite(parsed)) {
      setLocalError("Enter a valid number.");
      return;
    }
    setSaving(true);
    try {
      await setOpeningCashBalance(getDb(), parsed);
      setEditing(false);
      onSaved();
    } catch (e) {
      setLocalError(getFirestoreUserMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cash in hand breakdown</CardTitle>
          <CardDescription>
            Opening balance and how recorded activity adds up to total cash in hand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Calculating…</p>
        </CardContent>
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cash in hand breakdown</CardTitle>
          <CardDescription>
            Opening balance and how recorded activity adds up to total cash in hand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No data.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Cash in hand breakdown</CardTitle>
          <CardDescription>
            Opening cash + manual cash added - manual cash removed + walk-in sales + invoice
            payments collected - expenses - cash paid for stock receipts (FIFO lots from stock in).
            Invoice lines posted to sales are counted when customers pay, not at post time. This is
            your expected liquid cash estimate.
          </CardDescription>
        </div>
        {!editing ? (
          <Button type="button" variant="outline" className="shrink-0" onClick={startEdit}>
            Set opening balance
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {localError ? <InlineAlert variant="error">{localError}</InlineAlert> : null}

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total cash in hand
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {formatMoney(snapshot.totalCashInHand)}
          </p>
        </div>

        {editing ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <label htmlFor="opening-cash" className="text-sm font-medium text-foreground">
                Opening cash balance
              </label>
              <Input
                id="opening-cash"
                type="text"
                inputMode="decimal"
                value={openingInput}
                onChange={(e) => setOpeningInput(e.target.value)}
                placeholder="0"
                aria-describedby="opening-cash-hint"
              />
              <p id="opening-cash-hint" className="text-xs text-muted-foreground">
                Cash on hand before tracked activity in this app (or 0 if you started from empty).
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={() => void saveOpening()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-0 border-t border-border pt-2">
          <MetricRow label="Opening balance" value={formatMoney(snapshot.openingBalance)} />
          <MetricRow label="Manual cash added" value={formatMoney(snapshot.manualCashAdded)} />
          <MetricRow label="Manual cash removed" value={formatMoney(-snapshot.manualCashRemoved)} />
          <MetricRow label="Walk-in / non-invoice sales (cash)" value={formatMoney(snapshot.cashWalkInSales)} />
          <MetricRow
            label="Invoice payments collected"
            value={formatMoney(snapshot.cashInvoicePayments)}
          />
          <MetricRow label="Total expenses" value={formatMoney(-snapshot.totalExpenses)} />
          <MetricRow label="Stock purchases (stock in)" value={formatMoney(-snapshot.stockPurchasesCash)} />
        </div>
      </CardContent>
    </Card>
  );
}
