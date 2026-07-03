"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function parseDiscountAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney2(n);
}

type ApplyPostedInvoiceDiscountModalProps = {
  orderId: string;
  subtotalAmount: number;
  deliveryCharge: number;
  currentDiscount: number;
  currentTotal: number;
  returnedAmount: number;
  paidAmount: number;
  amountDue: number;
  pending?: boolean;
  onDismiss: () => void;
  onSubmit: (discountAmount: number) => Promise<void>;
};

export function ApplyPostedInvoiceDiscountModal({
  orderId,
  subtotalAmount,
  deliveryCharge,
  currentDiscount,
  currentTotal,
  returnedAmount,
  paidAmount,
  amountDue,
  pending = false,
  onDismiss,
  onSubmit,
}: ApplyPostedInvoiceDiscountModalProps) {
  const [discountInput, setDiscountInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDiscountInput(String(currentDiscount));
    setError(null);
  }, [orderId, currentDiscount]);

  const parsedDiscount = useMemo(() => parseDiscountAmount(discountInput), [discountInput]);

  const preview = useMemo(() => {
    if (parsedDiscount === null) return null;
    const total = roundMoney2(Math.max(0, subtotalAmount - parsedDiscount + deliveryCharge));
    const effectiveTotal = roundMoney2(Math.max(0, total - returnedAmount));
    const paidAfter = roundMoney2(Math.min(paidAmount, effectiveTotal));
    const dueAfter = roundMoney2(Math.max(0, effectiveTotal - paidAfter));
    return { total, effectiveTotal, paidAfter, dueAfter };
  }, [parsedDiscount, subtotalAmount, deliveryCharge, returnedAmount, paidAmount]);

  const maxDiscount = useMemo(() => {
    const capFromSubtotal = subtotalAmount;
    const capFromReturns = roundMoney2(subtotalAmount + deliveryCharge - returnedAmount);
    return roundMoney2(Math.max(0, Math.min(capFromSubtotal, capFromReturns)));
  }, [subtotalAmount, deliveryCharge, returnedAmount]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const discount = parseDiscountAmount(discountInput);
    if (discount === null) {
      setError("Enter a valid discount amount (zero or greater).");
      return;
    }
    if (discount > subtotalAmount + 0.01) {
      setError(`Discount cannot exceed subtotal (${formatMoney(subtotalAmount)}).`);
      return;
    }
    if (discount > maxDiscount + 0.01) {
      setError(
        returnedAmount > 0
          ? `Discount is too large after returns — maximum is ${formatMoney(maxDiscount)}.`
          : `Discount cannot exceed subtotal (${formatMoney(subtotalAmount)}).`,
      );
      return;
    }
    if (Math.abs(discount - currentDiscount) < 0.01) {
      setError("Discount is unchanged.");
      return;
    }
    try {
      await onSubmit(discount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply discount.");
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
        aria-labelledby="apply-discount-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="apply-discount-title" className="text-lg font-semibold text-foreground">
          Apply invoice discount
        </h2>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{orderId}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-muted/50 px-3 py-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="font-medium tabular-nums text-foreground">{formatMoney(subtotalAmount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Delivery</dt>
            <dd className="font-medium tabular-nums text-foreground">{formatMoney(deliveryCharge)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Current discount</dt>
            <dd className="font-medium tabular-nums text-foreground">{formatMoney(currentDiscount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Current total</dt>
            <dd className="font-medium tabular-nums text-foreground">{formatMoney(currentTotal)}</dd>
          </div>
          {returnedAmount > 0 ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Returned credit</dt>
              <dd className="font-medium tabular-nums text-accent-foreground">−{formatMoney(returnedAmount)}</dd>
            </div>
          ) : null}
          <div className="col-span-2">
            <dt className="text-muted-foreground">Amount due now</dt>
            <dd className="text-lg font-bold tabular-nums text-destructive">{formatMoney(amountDue)}</dd>
          </div>
        </dl>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invoice-discount">Invoice discount</Label>
            <Input
              id="invoice-discount"
              type="text"
              inputMode="decimal"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              placeholder="0"
              disabled={pending}
              aria-invalid={!!error}
            />
            <p className="text-xs text-muted-foreground">
              Maximum discount: <span className="font-medium text-foreground">{formatMoney(maxDiscount)}</span>
            </p>
            {preview && parsedDiscount !== null ? (
              <div className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <p>
                  New total:{" "}
                  <span className="font-medium text-foreground">{formatMoney(preview.total)}</span>
                  {returnedAmount > 0 ? (
                    <>
                      {" "}
                      → effective{" "}
                      <span className="font-medium text-foreground">{formatMoney(preview.effectiveTotal)}</span>
                    </>
                  ) : null}
                </p>
                <p className="mt-1">
                  New amount due:{" "}
                  <span className="font-semibold text-destructive">{formatMoney(preview.dueAfter)}</span>
                </p>
                {preview.paidAfter < paidAmount - 0.01 ? (
                  <p className="mt-1 text-amber-700 dark:text-amber-400">
                    Paid amount will be reduced from {formatMoney(paidAmount)} to{" "}
                    {formatMoney(preview.paidAfter)} because the new total is lower.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Apply discount"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
