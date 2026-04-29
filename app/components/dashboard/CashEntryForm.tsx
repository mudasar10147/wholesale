"use client";

import { useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { addCashEntry } from "@/lib/firestore/cashEntries";
import type { CashEntryType } from "@/lib/types/firestore";
import { parsePositiveAmount } from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInput(value: string): Date | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

type CashEntryFormProps = {
  onCreated: () => Promise<void> | void;
};

export function CashEntryForm({ onCreated }: CashEntryFormProps) {
  const [entryType, setEntryType] = useState<CashEntryType>("add");
  const [amount, setAmount] = useState("");
  const [dateInput, setDateInput] = useState(() => toDateInputValue(new Date()));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const parsedAmount = parsePositiveAmount(amount);
    if (!parsedAmount.ok) {
      setError(parsedAmount.message ?? "Amount must be greater than zero.");
      return;
    }
    const parsedDate = parseDateInput(dateInput);
    if (!parsedDate) {
      setError("Date must be valid (YYYY-MM-DD).");
      return;
    }

    setSubmitting(true);
    try {
      await addCashEntry(getDb(), {
        entryType,
        amount: parsedAmount.value,
        date: parsedDate,
        note,
      });
      setAmount("");
      setNote("");
      setSuccess(entryType === "add" ? "Cash added successfully." : "Cash removed successfully.");
      await onCreated();
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="cash-entry-type">Entry type</Label>
          <select
            id="cash-entry-type"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
            value={entryType}
            onChange={(e) => setEntryType(e.target.value as CashEntryType)}
          >
            <option value="add">Add cash</option>
            <option value="remove">Remove cash</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-entry-amount">Amount</Label>
          <Input
            id="cash-entry-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-entry-date">Date</Label>
          <Input
            id="cash-entry-date"
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-entry-note">Note (optional)</Label>
          <Input
            id="cash-entry-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why was this cash added/removed?"
            maxLength={500}
          />
        </div>
      </div>
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : entryType === "add" ? "Add cash entry" : "Remove cash entry"}
      </Button>
    </form>
  );
}
