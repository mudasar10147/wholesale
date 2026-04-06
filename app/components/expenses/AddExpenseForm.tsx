"use client";

import { useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { addExpense } from "@/lib/firestore/expenses";
import { parsePositiveAmount } from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

export function AddExpenseForm() {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required.");
      return;
    }

    const parsed = parsePositiveAmount(amount);
    if (!parsed.ok) {
      setError(parsed.message ?? "Enter a valid amount greater than zero.");
      return;
    }

    setSubmitting(true);
    try {
      await addExpense(getDb(), { title: trimmed, amount: parsed.value });
      setTitle("");
      setAmount("");
      setSuccess(true);
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:max-w-md">
        <div className="space-y-2">
          <Label htmlFor="expense-title">Title</Label>
          <Input
            id="expense-title"
            name="title"
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Rent, Transport"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="expense-amount">Amount</Label>
          <Input
            id="expense-amount"
            name="amount"
            inputMode="decimal"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>

      {error ? (
        <InlineAlert variant="error">{error}</InlineAlert>
      ) : null}
      {success ? (
        <InlineAlert variant="success">Expense saved.</InlineAlert>
      ) : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Add expense"}
      </Button>
    </form>
  );
}
