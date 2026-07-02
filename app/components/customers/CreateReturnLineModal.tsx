"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CustomerPurchaseLine } from "@/lib/firestore/customerPurchaseHistory";
import {
  createReturnDraft,
  postReturn,
  suggestSettlementType,
} from "@/lib/firestore/invoiceReturns";
import { calculateReturnSummary } from "@/lib/invoices/returnCalculations";
import type { InvoiceDoc, InvoiceReturnDoc } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

type CreateReturnLineModalProps = {
  line: CustomerPurchaseLine;
  customerName: string;
  productName: string;
  onDismiss: () => void;
};

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseReturnQty(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || String(n) !== raw.trim()) {
    throw new Error("Return quantity must be a whole number zero or greater.");
  }
  return n;
}

function formatInvoiceDate(line: CustomerPurchaseLine): string {
  if (!line.invoiceDate) return "—";
  try {
    return line.invoiceDate.toDate().toLocaleDateString();
  } catch {
    return "—";
  }
}

export function CreateReturnLineModal({
  line,
  customerName,
  productName,
  onDismiss,
}: CreateReturnLineModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [settlementType, setSettlementType] =
    useState<InvoiceReturnDoc["settlement_type"]>("reduce_balance");
  const [returnQty, setReturnQty] = useState("1");
  const [restockQty, setRestockQty] = useState("1");
  const [discardQty, setDiscardQty] = useState("0");
  const [returnReason, setReturnReason] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !working) onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss, working]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const invSnap = await getDoc(doc(getDb(), COLLECTIONS.invoices, line.invoiceId));
        if (!invSnap.exists()) throw new Error("Invoice not found.");
        const invoice = invSnap.data() as InvoiceDoc;
        if (invoice.status !== "posted") {
          throw new Error("Only posted invoices can have returns.");
        }
        if (!cancelled) {
          setSettlementType(suggestSettlementType(invoice));
        }
      } catch (err) {
        if (!cancelled) setError(getFirestoreUserMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [line.invoiceId]);

  const maxQty = line.returnableQuantity;

  const preview = useMemo(() => {
    try {
      const qty = parseReturnQty(returnQty);
      const restock = parseReturnQty(restockQty);
      const discard = parseReturnQty(discardQty);
      if (qty <= 0) return null;
      if (qty > maxQty) return null;
      if (restock + discard !== qty) return null;

      const originalItems = new Map([
        [
          line.invoiceItemId,
          {
            invoice_id: line.invoiceId,
            order_id: line.orderId,
            customer_id: "",
            product_id: line.productId,
            quantity: line.soldQuantity,
            unit_price: line.unitPrice,
            line_discount: line.lineDiscount,
            line_delivery_charge: line.lineDeliveryCharge,
            line_total: line.lineTotal,
            created_at: {} as never,
            updated_at: {} as never,
          },
        ],
      ]);

      return calculateReturnSummary(
        [
          {
            original_invoice_item_id: line.invoiceItemId,
            product_id: line.productId,
            quantity_returned: qty,
            quantity_restock: restock,
            quantity_discard: discard,
          },
        ],
        originalItems,
      );
    } catch {
      return null;
    }
  }, [line, returnQty, restockQty, discardQty, maxQty]);

  function updateReturnQty(raw: string) {
    const qty = Number.parseInt(raw, 10);
    const safeQty = Number.isNaN(qty) || qty < 0 ? 0 : Math.min(qty, maxQty);
    setReturnQty(String(safeQty));
    setRestockQty(String(safeQty));
    setDiscardQty("0");
  }

  function updateRestockQty(raw: string) {
    const qty = parseReturnQty(returnQty);
    const restock = Number.parseInt(raw, 10);
    const safeRestock = Number.isNaN(restock) || restock < 0 ? 0 : Math.min(restock, qty);
    setRestockQty(String(safeRestock));
    setDiscardQty(String(qty - safeRestock));
  }

  function updateDiscardQty(raw: string) {
    const qty = parseReturnQty(returnQty);
    const discard = Number.parseInt(raw, 10);
    const safeDiscard = Number.isNaN(discard) || discard < 0 ? 0 : Math.min(discard, qty);
    setDiscardQty(String(safeDiscard));
    setRestockQty(String(qty - safeDiscard));
  }

  async function handleSubmit(e: FormEvent, postAfterSave: boolean) {
    e.preventDefault();
    setSubmitError(null);
    setWorking(postAfterSave ? "post" : "save");

    try {
      const qty = parseReturnQty(returnQty);
      const restock = parseReturnQty(restockQty);
      const discard = parseReturnQty(discardQty);
      if (qty <= 0) throw new Error("Enter a return quantity greater than zero.");
      if (qty > maxQty) throw new Error("Return quantity exceeds returnable amount.");
      if (restock + discard !== qty) {
        throw new Error("Restock and discard must add up to the return quantity.");
      }

      const { returnId } = await createReturnDraft(getDb(), {
        original_invoice_id: line.invoiceId,
        lines: [
          {
            original_invoice_item_id: line.invoiceItemId,
            product_id: line.productId,
            quantity_returned: qty,
            quantity_restock: restock,
            quantity_discard: discard,
          },
        ],
        settlement_type: settlementType,
        return_reason: returnReason.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (postAfterSave) {
        await postReturn(getDb(), returnId);
      }

      router.push(`/sales/returns/${returnId}`);
    } catch (err) {
      setSubmitError(getFirestoreUserMessage(err));
    } finally {
      setWorking(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !working) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-return-line-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="create-return-line-title" className="text-lg font-semibold text-foreground">
              Create return
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {customerName} · {productName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Invoice {line.orderId} · {formatInvoiceDate(line)} · {line.returnableQuantity} of{" "}
              {line.soldQuantity} returnable
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            aria-label="Close"
            disabled={working !== null}
            onClick={onDismiss}
          >
            ×
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading invoice…</p>
        ) : error ? (
          <InlineAlert variant="error">{error}</InlineAlert>
        ) : (
          <form className="space-y-4" onSubmit={(e) => void handleSubmit(e, false)}>
            <p className="text-sm text-muted-foreground">
              Restocked units go back into inventory. Discarded (damaged) units are credited to the
              customer but are not added back to stock.
            </p>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="return-qty">Qty to return</Label>
                <Input
                  id="return-qty"
                  type="number"
                  min={0}
                  max={maxQty}
                  step={1}
                  value={returnQty}
                  onChange={(e) => updateReturnQty(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="return-restock">Restock</Label>
                <Input
                  id="return-restock"
                  type="number"
                  min={0}
                  max={Number.parseInt(returnQty, 10) || 0}
                  step={1}
                  value={restockQty}
                  onChange={(e) => updateRestockQty(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="return-discard">Discard</Label>
                <Input
                  id="return-discard"
                  type="number"
                  min={0}
                  max={Number.parseInt(returnQty, 10) || 0}
                  step={1}
                  value={discardQty}
                  onChange={(e) => updateDiscardQty(e.target.value)}
                />
              </div>
            </div>

            {preview && preview.total_amount > 0 ? (
              <p className="text-sm text-muted-foreground">
                Return credit:{" "}
                <strong className="text-foreground">{money(preview.total_amount)}</strong>
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="return-settlement">Settlement</Label>
              <select
                id="return-settlement"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                value={settlementType}
                onChange={(e) =>
                  setSettlementType(e.target.value as InvoiceReturnDoc["settlement_type"])
                }
              >
                <option value="reduce_balance">Reduce balance owed</option>
                <option value="cash_refund">Cash refund to customer</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="return-reason">Reason (optional)</Label>
              <Input
                id="return-reason"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Damaged, wrong item, etc."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="return-notes">Notes (optional)</Label>
              <Input id="return-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {submitError ? <InlineAlert variant="error">{submitError}</InlineAlert> : null}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" variant="outline" disabled={working !== null}>
                {working === "save" ? "Saving…" : "Save draft"}
              </Button>
              <Button
                type="button"
                disabled={working !== null || !preview || preview.total_amount <= 0}
                onClick={(e) => void handleSubmit(e, true)}
              >
                {working === "post" ? "Posting…" : "Post return"}
              </Button>
              <Button type="button" variant="outline" disabled={working !== null} onClick={onDismiss}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
