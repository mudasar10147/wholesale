"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { addCashEntry, entryTypeForLoanKind } from "@/lib/firestore/cashEntries";
import type { CashEntryType, LoanEntryKind } from "@/lib/types/firestore";
import { parsePositiveAmount } from "@/lib/validation/numbers";
import { PartySelectInput } from "@/app/components/parties/PartySelectInput";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";
import { cn } from "@/lib/utils";

type EntryMode = "general" | "loan";

const LOAN_KIND_LABELS: Record<LoanEntryKind, string> = {
  borrowed: "Borrowed money (cash in)",
  repaid: "Repaid a loan (cash out)",
  lent: "Lent money out (cash out)",
  collected: "Collected a loan (cash in)",
};

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

type AddCashEntryModalProps = {
  onDismiss: () => void;
  onCreated?: () => void;
  initialMode?: EntryMode;
  initialLoanKind?: LoanEntryKind;
  initialPartyId?: string;
  initialPartyName?: string;
  /** When true, the General/Loan toggle is hidden and the modal stays in `initialMode`. */
  lockMode?: boolean;
};

export function AddCashEntryModal({
  onDismiss,
  onCreated,
  initialMode = "general",
  initialLoanKind = "borrowed",
  initialPartyId = "",
  initialPartyName = "",
  lockMode = false,
}: AddCashEntryModalProps) {
  const [mode, setMode] = useState<EntryMode>(initialMode);
  const [entryType, setEntryType] = useState<CashEntryType>("add");
  const [loanKind, setLoanKind] = useState<LoanEntryKind>(initialLoanKind);
  const [amount, setAmount] = useState("");
  const [dateInput, setDateInput] = useState(() => toDateInputValue(new Date()));
  const [partyId, setPartyId] = useState(initialPartyId);
  const [partyName, setPartyName] = useState(initialPartyName);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss, submitting]);

  const loanDirection = entryTypeForLoanKind(loanKind);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

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
    if (mode === "loan" && !partyId) {
      setError("A loan needs a party — pick who you borrowed from or lent to.");
      return;
    }

    setSubmitting(true);
    try {
      await addCashEntry(getDb(), {
        entryType: mode === "loan" ? loanDirection : entryType,
        amount: parsedAmount.value,
        date: parsedDate,
        note,
        partyId: partyId || undefined,
        partyName: partyName || undefined,
        loanKind: mode === "loan" ? loanKind : undefined,
      });
      onCreated?.();
      onDismiss();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const partyLabel =
    mode === "loan"
      ? loanKind === "borrowed" || loanKind === "repaid"
        ? "Lender (party)"
        : "Borrower (party)"
      : entryType === "add"
        ? "From (party)"
        : "To (party)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="presentation"
      onClick={() => {
        if (!submitting) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="add-cash-entry-title"
        className="my-8 w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="add-cash-entry-title" className="text-lg font-semibold text-foreground">
              {lockMode && mode === "loan" ? "Add loan entry" : "Add cash entry"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {lockMode && mode === "loan"
                ? "Record money borrowed, repaid, lent, or collected. This also adjusts your cash-in-hand total."
                : "Record cash put in or taken out by hand. These adjust your cash-in-hand total."}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {!lockMode ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("general")}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium",
                  mode === "general"
                    ? "border-foreground bg-surface-hover text-foreground"
                    : "border-border text-muted-foreground hover:bg-surface-hover",
                )}
                aria-pressed={mode === "general"}
              >
                General
              </button>
              <button
                type="button"
                onClick={() => setMode("loan")}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium",
                  mode === "loan"
                    ? "border-foreground bg-surface-hover text-foreground"
                    : "border-border text-muted-foreground hover:bg-surface-hover",
                )}
                aria-pressed={mode === "loan"}
              >
                Loan
              </button>
            </div>
          ) : null}

          {mode === "general" ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEntryType("add")}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium",
                  entryType === "add"
                    ? "border-success bg-success-muted text-success"
                    : "border-border text-muted-foreground hover:bg-surface-hover",
                )}
                aria-pressed={entryType === "add"}
              >
                Cash in
              </button>
              <button
                type="button"
                onClick={() => setEntryType("remove")}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium",
                  entryType === "remove"
                    ? "border-destructive bg-destructive-muted text-destructive"
                    : "border-border text-muted-foreground hover:bg-surface-hover",
                )}
                aria-pressed={entryType === "remove"}
              >
                Cash out
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="loan-kind">Loan action</Label>
              <Select
                id="loan-kind"
                value={loanKind}
                onChange={(e) => setLoanKind(e.target.value as LoanEntryKind)}
              >
                {(Object.keys(LOAN_KIND_LABELS) as LoanEntryKind[]).map((k) => (
                  <option key={k} value={k}>
                    {LOAN_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                This will be recorded as{" "}
                <strong className={loanDirection === "add" ? "text-success" : "text-destructive"}>
                  {loanDirection === "add" ? "cash in (+)" : "cash out (−)"}
                </strong>
                .
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cash-amount">Amount</Label>
              <Input
                id="cash-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cash-date">Date</Label>
              <Input
                id="cash-date"
                type="date"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cash-party">
              {partyLabel}{" "}
              {mode === "loan" ? (
                <span className="font-normal text-destructive">— required</span>
              ) : (
                <span className="font-normal text-muted-foreground">— optional</span>
              )}
            </Label>
            <PartySelectInput
              id="cash-party"
              value={partyId}
              onChange={(id, name) => {
                setPartyId(id);
                setPartyName(name);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {mode === "loan"
                ? "Who you borrowed from or lent to. Outstanding balances are tracked per party on the Loans page."
                : "Who this cash came from or went to (owner, investor, lender, bank…). Add a new party with “New”."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cash-note">Note (optional)</Label>
            <Input
              id="cash-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason / reference"
              maxLength={500}
            />
          </div>

          {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={submitting} onClick={onDismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save entry"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
