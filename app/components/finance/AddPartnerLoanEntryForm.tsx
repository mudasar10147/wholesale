"use client";

import { useMemo, useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { addPartnerLoanEntry } from "@/lib/firestore/partnerLoans";
import { parsePositiveAmount } from "@/lib/validation/numbers";
import type { PartnerLoanEntryType } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

function toLocalDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDateInput(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

export function AddPartnerLoanEntryForm() {
  const [partnerName, setPartnerName] = useState("");
  const [entryType, setEntryType] = useState<PartnerLoanEntryType>("loan_in");
  const [amount, setAmount] = useState("");
  const [dateInput, setDateInput] = useState(() => toLocalDateInputValue(new Date()));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submitLabel = useMemo(
    () => {
      if (entryType === "loan_in") return "Add loan in entry";
      if (entryType === "repayment") return "Add repayment entry";
      if (entryType === "loan_given") return "Add loan given entry";
      return "Add loan return entry";
    },
    [entryType],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const partner = partnerName.trim();
    if (partner.length < 2) {
      setError("Partner name must be at least 2 characters.");
      return;
    }
    const parsedAmount = parsePositiveAmount(amount);
    if (!parsedAmount.ok) {
      setError(parsedAmount.message ?? "Amount must be greater than zero.");
      return;
    }
    const parsedDate = parseLocalDateInput(dateInput);
    if (!parsedDate) {
      setError("Date must be valid (YYYY-MM-DD).");
      return;
    }

    setSubmitting(true);
    try {
      await addPartnerLoanEntry(getDb(), {
        partnerName: partner,
        entryType,
        amount: parsedAmount.value,
        date: parsedDate,
        note,
      });
      setAmount("");
      setNote("");
      setSuccess(true);
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:max-w-xl sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="loan-partner-name">Partner</Label>
          <Input
            id="loan-partner-name"
            autoComplete="off"
            value={partnerName}
            onChange={(e) => setPartnerName(e.target.value)}
            placeholder="e.g. Yasir"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="loan-entry-type">Entry type</Label>
          <select
            id="loan-entry-type"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
            value={entryType}
            onChange={(e) => setEntryType(e.target.value as PartnerLoanEntryType)}
          >
            <option value="loan_in">Loan in (partner gives money to company)</option>
            <option value="repayment">Repayment (company pays partner back)</option>
            <option value="loan_given">Loan given (company gives money to partner)</option>
            <option value="loan_given_return">Loan given return (partner returns money to company)</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="loan-amount">Amount</Label>
          <Input
            id="loan-amount"
            inputMode="decimal"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="loan-date">Date</Label>
          <Input
            id="loan-date"
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="loan-note">Note (optional)</Label>
          <Input
            id="loan-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Working capital for April purchase"
            maxLength={500}
          />
        </div>
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {success ? (
        <InlineAlert variant="success">Loan ledger entry saved.</InlineAlert>
      ) : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
