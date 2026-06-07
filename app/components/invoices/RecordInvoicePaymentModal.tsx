"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parsePaymentAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

type RecordInvoicePaymentModalProps = {
  orderId: string;
  effectiveTotal: number;
  paidAmount: number;
  amountDue: number;
  pending?: boolean;
  onDismiss: () => void;
  onSubmit: (amount: number) => Promise<void>;
};

export function RecordInvoicePaymentModal({
  orderId,
  effectiveTotal,
  paidAmount,
  amountDue,
  pending = false,
  onDismiss,
  onSubmit,
}: RecordInvoicePaymentModalProps) {
  const [amountInput, setAmountInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAmountInput(amountDue > 0 ? String(amountDue) : "");
    setError(null);
  }, [orderId, amountDue]);

  const parsedAmount = useMemo(() => parsePaymentAmount(amountInput), [amountInput]);
  const remainingAfter = parsedAmount !== null ? Math.max(0, amountDue - parsedAmount) : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = parsePaymentAmount(amountInput);
    if (amount === null) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    if (amount > amountDue + 0.01) {
      setError(`Payment cannot exceed amount due (${formatMoney(amountDue)}).`);
      return;
    }
    try {
      await onSubmit(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={pending ? undefined : onDismiss}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-payment-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="record-payment-title" className="text-lg font-semibold text-foreground">
          Record payment
        </h2>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{orderId}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-muted/50 px-3 py-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Invoice total</dt>
            <dd className="font-medium tabular-nums text-foreground">{formatMoney(effectiveTotal)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Already paid</dt>
            <dd className="font-medium tabular-nums text-success">{formatMoney(paidAmount)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Amount due</dt>
            <dd className="text-lg font-bold tabular-nums text-destructive">{formatMoney(amountDue)}</dd>
          </div>
        </dl>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payment-amount">Payment amount</Label>
            <Input
              id="payment-amount"
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0"
              disabled={pending}
              aria-invalid={!!error}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={pending || amountDue <= 0.01}
                onClick={() => setAmountInput(String(amountDue))}
              >
                Pay full balance
              </Button>
            </div>
            {remainingAfter !== null && parsedAmount !== null && parsedAmount <= amountDue + 0.01 ? (
              <p className="text-xs text-muted-foreground">
                {remainingAfter <= 0.01 ? (
                  <span className="font-medium text-success">Invoice will be fully paid.</span>
                ) : (
                  <>
                    Remaining due after payment:{" "}
                    <span className="font-medium text-foreground">{formatMoney(remainingAfter)}</span>
                  </>
                )}
              </p>
            ) : null}
          </div>

          {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || amountDue <= 0.01}>
              {pending ? "Saving…" : "Record payment"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
