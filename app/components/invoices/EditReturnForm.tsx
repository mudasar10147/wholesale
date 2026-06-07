"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  loadReturnableContext,
  postReturn,
  updateReturnDraft,
  type ReturnableLine,
} from "@/lib/firestore/invoiceReturns";
import { calculateReturnSummary } from "@/lib/invoices/returnCalculations";
import {
  getInvoiceAmountDue,
  getInvoiceEffectiveTotal,
  getInvoicePaidAmount,
  getInvoicePostedTotal,
  getInvoiceReturnedAmount,
} from "@/lib/invoices/invoiceEffective";
import type { InvoiceReturnDoc } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

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

type Props = {
  returnId: string;
  returnNumber: string;
  invoiceId: string;
  orderId: string;
  initialSettlementType: InvoiceReturnDoc["settlement_type"];
  initialReturnReason: string;
  initialNotes: string;
  initialQtyByItem: Record<string, string>;
  initialRestockByItem: Record<string, string>;
  initialDiscardByItem: Record<string, string>;
  onSaved: () => void;
  onCancel: () => void;
};

export function EditReturnForm({
  returnId,
  returnNumber,
  invoiceId,
  orderId,
  initialSettlementType,
  initialReturnReason,
  initialNotes,
  initialQtyByItem,
  initialRestockByItem,
  initialDiscardByItem,
  onSaved,
  onCancel,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [returnableLines, setReturnableLines] = useState<ReturnableLine[]>([]);
  const [invoiceSummary, setInvoiceSummary] = useState<{
    postedTotal: number;
    returned: number;
    effective: number;
    paid: number;
    due: number;
  } | null>(null);
  const [qtyByItem, setQtyByItem] = useState<Record<string, string>>(initialQtyByItem);
  const [restockByItem, setRestockByItem] = useState<Record<string, string>>(initialRestockByItem);
  const [discardByItem, setDiscardByItem] = useState<Record<string, string>>(initialDiscardByItem);
  const [settlementType, setSettlementType] = useState(initialSettlementType);
  const [returnReason, setReturnReason] = useState(initialReturnReason);
  const [notes, setNotes] = useState(initialNotes);
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.products), (snap) => {
      const map = new Map<string, string>();
      snap.forEach((d) => {
        const name = (d.data().name as string | undefined)?.trim();
        map.set(d.id, name || d.id);
      });
      setProductNames(map);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReturnableContext(getDb(), invoiceId);
        if (cancelled) return;
        setReturnableLines(ctx.lines);
        setInvoiceSummary({
          postedTotal: getInvoicePostedTotal(ctx.invoice),
          returned: getInvoiceReturnedAmount(ctx.invoice),
          effective: getInvoiceEffectiveTotal(ctx.invoice),
          paid: getInvoicePaidAmount(ctx.invoice),
          due: getInvoiceAmountDue(ctx.invoice),
        });
        setQtyByItem((prev) => {
          const next: Record<string, string> = {};
          for (const line of ctx.lines) {
            const id = line.original_invoice_item_id;
            next[id] = prev[id] ?? initialQtyByItem[id] ?? "0";
          }
          return next;
        });
        setRestockByItem((prev) => {
          const next: Record<string, string> = {};
          for (const line of ctx.lines) {
            const id = line.original_invoice_item_id;
            next[id] = prev[id] ?? initialRestockByItem[id] ?? initialQtyByItem[id] ?? "0";
          }
          return next;
        });
        setDiscardByItem((prev) => {
          const next: Record<string, string> = {};
          for (const line of ctx.lines) {
            const id = line.original_invoice_item_id;
            next[id] = prev[id] ?? initialDiscardByItem[id] ?? "0";
          }
          return next;
        });
      } catch (err) {
        if (!cancelled) setError(getFirestoreUserMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, initialQtyByItem, initialRestockByItem, initialDiscardByItem]);

  function updateReturnQty(itemId: string, rawQty: string) {
    const qty = Number.parseInt(rawQty, 10);
    const safeQty = Number.isNaN(qty) || qty < 0 ? "0" : String(qty);
    setQtyByItem((prev) => ({ ...prev, [itemId]: safeQty }));
    setRestockByItem((prev) => ({ ...prev, [itemId]: safeQty }));
    setDiscardByItem((prev) => ({ ...prev, [itemId]: "0" }));
  }

  function updateRestockQty(itemId: string, rawRestock: string, maxQty: number) {
    const restock = Number.parseInt(rawRestock, 10);
    const safeRestock = Number.isNaN(restock) || restock < 0 ? 0 : Math.min(restock, maxQty);
    setRestockByItem((prev) => ({ ...prev, [itemId]: String(safeRestock) }));
    setDiscardByItem((prev) => ({ ...prev, [itemId]: String(maxQty - safeRestock) }));
  }

  function updateDiscardQty(itemId: string, rawDiscard: string, maxQty: number) {
    const discard = Number.parseInt(rawDiscard, 10);
    const safeDiscard = Number.isNaN(discard) || discard < 0 ? 0 : Math.min(discard, maxQty);
    setDiscardByItem((prev) => ({ ...prev, [itemId]: String(safeDiscard) }));
    setRestockByItem((prev) => ({ ...prev, [itemId]: String(maxQty - safeDiscard) }));
  }

  const preview = useMemo(() => {
    if (returnableLines.length === 0) return null;
    try {
      const originalItems = new Map(
        returnableLines.map((l) => [
          l.original_invoice_item_id,
          {
            invoice_id: invoiceId,
            order_id: orderId,
            customer_id: "",
            product_id: l.product_id,
            quantity: l.sold_quantity,
            unit_price: l.unit_price,
            line_discount: l.line_discount,
            line_delivery_charge: l.line_delivery_charge,
            line_total: l.line_total,
            created_at: {} as never,
            updated_at: {} as never,
          },
        ]),
      );
      const lines = returnableLines
        .map((l) => {
          const id = l.original_invoice_item_id;
          const parsed = parseReturnQty(qtyByItem[id] ?? "0");
          const restock = parseReturnQty(restockByItem[id] ?? "0");
          const discard = parseReturnQty(discardByItem[id] ?? "0");
          return {
            original_invoice_item_id: id,
            product_id: l.product_id,
            quantity_returned: parsed,
            quantity_restock: restock,
            quantity_discard: discard,
          };
        })
        .filter((l) => l.quantity_returned > 0);
      if (lines.length === 0) return { subtotal_amount: 0, total_amount: 0, lines: [] };
      return calculateReturnSummary(lines, originalItems);
    } catch {
      return null;
    }
  }, [returnableLines, qtyByItem, restockByItem, discardByItem, invoiceId, orderId]);

  async function saveLines(postAfterSave: boolean) {
    const lines = returnableLines.map((l) => {
      const id = l.original_invoice_item_id;
      const qty = parseReturnQty(qtyByItem[id] ?? "0");
      const restock = parseReturnQty(restockByItem[id] ?? "0");
      const discard = parseReturnQty(discardByItem[id] ?? "0");
      if (qty > l.returnable_quantity) {
        throw new Error("Return quantity exceeds returnable amount for a line.");
      }
      if (restock + discard !== qty) {
        throw new Error("Restock and discard must add up to the return quantity.");
      }
      return {
        original_invoice_item_id: id,
        product_id: l.product_id,
        quantity_returned: qty,
        quantity_restock: restock,
        quantity_discard: discard,
      };
    });

    await updateReturnDraft(getDb(), returnId, {
      original_invoice_id: invoiceId,
      lines,
      settlement_type: settlementType,
      return_reason: returnReason.trim() || undefined,
      notes: notes.trim() || undefined,
    });

    if (postAfterSave) {
      await postReturn(getDb(), returnId);
    }
  }

  async function handleSubmit(e: FormEvent, postAfterSave: boolean) {
    e.preventDefault();
    setSubmitError(null);
    setWorking(postAfterSave ? "post" : "save");

    try {
      await saveLines(postAfterSave);
      onSaved();
    } catch (err) {
      setSubmitError(getFirestoreUserMessage(err));
    } finally {
      setWorking(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading return for edit…</p>;
  }

  if (error) {
    return <InlineAlert variant="error">{error}</InlineAlert>;
  }

  return (
    <form className="space-y-6" onSubmit={(e) => void handleSubmit(e, false)}>
      <Card>
        <CardHeader>
          <CardTitle>Edit draft {returnNumber}</CardTitle>
          <CardDescription>
            Invoice {orderId}
            {invoiceSummary ? (
              <>
                {" "}
                · Posted {money(invoiceSummary.postedTotal)}
                {invoiceSummary.returned > 0 ? ` · Returned ${money(invoiceSummary.returned)}` : ""}
                {" "}
                · Effective {money(invoiceSummary.effective)} · Paid {money(invoiceSummary.paid)} · Due{" "}
                {money(invoiceSummary.due)}
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Discarded (damaged) units are credited to the customer but are not added back to stock.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 font-semibold text-foreground">Product</th>
                  <th className="px-3 py-2 font-semibold text-foreground">Sold</th>
                  <th className="px-3 py-2 font-semibold text-foreground">Returned</th>
                  <th className="px-3 py-2 font-semibold text-foreground">Returnable</th>
                  <th className="px-3 py-2 font-semibold text-foreground">Qty to return</th>
                  <th className="px-3 py-2 font-semibold text-foreground">Restock</th>
                  <th className="px-3 py-2 font-semibold text-foreground">Discard</th>
                  <th className="px-3 py-2 font-semibold text-foreground">Unit</th>
                </tr>
              </thead>
              <tbody>
                {returnableLines.map((line) => {
                  const itemId = line.original_invoice_item_id;
                  const returnQty = Number.parseInt(qtyByItem[itemId] ?? "0", 10) || 0;
                  return (
                  <tr key={itemId} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 text-foreground">
                      {productNames.get(line.product_id) ?? line.product_id}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{line.sold_quantity}</td>
                    <td className="px-3 py-2 tabular-nums">{line.already_returned}</td>
                    <td className="px-3 py-2 tabular-nums">{line.returnable_quantity}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        max={line.returnable_quantity}
                        step={1}
                        disabled={line.returnable_quantity <= 0}
                        value={qtyByItem[itemId] ?? "0"}
                        onChange={(ev) => updateReturnQty(itemId, ev.target.value)}
                        className="w-20"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        max={returnQty}
                        step={1}
                        disabled={returnQty <= 0}
                        value={restockByItem[itemId] ?? "0"}
                        onChange={(ev) => updateRestockQty(itemId, ev.target.value, returnQty)}
                        className="w-20"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        max={returnQty}
                        step={1}
                        disabled={returnQty <= 0}
                        value={discardByItem[itemId] ?? "0"}
                        onChange={(ev) => updateDiscardQty(itemId, ev.target.value, returnQty)}
                        className="w-20"
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{money(line.unit_price)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview && preview.total_amount > 0 ? (
            <p className="text-sm text-muted-foreground">
              Return credit preview:{" "}
              <strong className="tabular-nums text-foreground">{money(preview.total_amount)}</strong>
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-settlement-type">Settlement</Label>
              <select
                id="edit-settlement-type"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
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
              <Label htmlFor="edit-return-reason">Reason (optional)</Label>
              <Input
                id="edit-return-reason"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Damaged, wrong item, etc."
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-return-notes">Notes (optional)</Label>
            <Input id="edit-return-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {submitError ? <InlineAlert variant="error">{submitError}</InlineAlert> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={working !== null}>
          {working === "save" ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          disabled={working !== null || !preview || preview.total_amount <= 0}
          onClick={(e) => void handleSubmit(e, true)}
        >
          {working === "post" ? "Posting…" : "Save and post"}
        </Button>
        <Button type="button" variant="outline" disabled={working !== null} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
