"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  fetchCashSettings,
  getActualCashBalance,
  getOpeningBalance,
  setActualCashBalance,
  setOpeningCashBalance,
} from "@/lib/firestore/cashSettings";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

/** Comma-tolerant, matching what the dashboard cards accepted before this moved. */
function parseMoneyInput(value: string): number | null {
  const parsed = Number.parseFloat(value.trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Edits the two stored cash values.
 *
 * These used to live on the dashboard inside cards that needed a full
 * CashInHandSnapshot — all sales, expenses, invoices, stock lots and cash
 * entries, ~2,700 reads. Setting the values only needs the `settings/cash`
 * document, so this form reads exactly one.
 */
export function CashSettingsForm() {
  const [openingInput, setOpeningInput] = useState("0");
  const [actualInput, setActualInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await fetchCashSettings(getDb());
        if (cancelled) return;
        setOpeningInput(String(getOpeningBalance(settings)));
        const actual = getActualCashBalance(settings);
        setActualInput(actual === null ? "" : String(actual));
      } catch (err) {
        if (!cancelled) setError(getFirestoreUserMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const opening = parseMoneyInput(openingInput);
    if (opening === null) {
      setError("Opening balance must be a valid number.");
      return;
    }

    // Blank means "not counted yet" — the stored value is left untouched rather
    // than being overwritten with zero.
    const trimmedActual = actualInput.trim();
    const actual = trimmedActual === "" ? null : parseMoneyInput(trimmedActual);
    if (trimmedActual !== "" && actual === null) {
      setError("Counted cash must be a valid number, or left blank.");
      return;
    }

    setSaving(true);
    try {
      const db = getDb();
      await setOpeningCashBalance(db, opening);
      if (actual !== null) {
        await setActualCashBalance(db, actual);
      }
      setSuccess("Cash settings saved.");
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading cash settings…</p>;
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cash-opening-balance">Opening cash balance</Label>
          <Input
            id="cash-opening-balance"
            inputMode="decimal"
            value={openingInput}
            onChange={(e) => {
              setOpeningInput(e.target.value);
              setSuccess(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Cash in the business before any recorded sale or expense. Every cash figure builds on
            this.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cash-actual-balance">Counted cash (optional)</Label>
          <Input
            id="cash-actual-balance"
            inputMode="decimal"
            placeholder="Not counted yet"
            value={actualInput}
            onChange={(e) => {
              setActualInput(e.target.value);
              setSuccess(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            What was physically counted, for comparison against the expected figure. Leave blank to
            keep the stored value unchanged.
          </p>
        </div>
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save cash settings"}
      </Button>
    </form>
  );
}
