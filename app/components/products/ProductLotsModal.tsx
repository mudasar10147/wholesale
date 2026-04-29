"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  convertOpeningBalanceLotToStockIn,
  createAdjustmentLot,
  deleteLotAndSyncProduct,
  syncProductStockFromLots,
  updateLotAndSyncProduct,
} from "@/lib/firestore/lotAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProductDoc, StockLotDoc } from "@/lib/types/firestore";
import {
  parseNonNegativeDecimal,
  parseNonNegativeIntStrict,
  parsePositiveIntStrict,
} from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

type ProductRow = ProductDoc & { id: string };
type LotRow = StockLotDoc & { id: string };

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(ts: Timestamp) {
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

function LotEditRow({ productId, lot }: { productId: string; lot: LotRow }) {
  const [qty, setQty] = useState(() => String(lot.qty_remaining));
  const [cost, setCost] = useState(() => String(lot.unit_cost));
  const [pending, setPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [convertPending, setConvertPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQty(String(lot.qty_remaining));
    setCost(String(lot.unit_cost));
    setError(null);
  }, [lot.id, lot.qty_remaining, lot.unit_cost]);

  async function handleSave() {
    setError(null);
    const qtyParsed = parseNonNegativeIntStrict(qty);
    if (!qtyParsed.ok) {
      setError(qtyParsed.message ?? "Invalid quantity remaining.");
      return;
    }
    if (qtyParsed.value > lot.qty_in) {
      setError(`Cannot exceed qty in (${lot.qty_in}).`);
      return;
    }
    const costParsed = parseNonNegativeDecimal(cost);
    if (!costParsed.ok) {
      setError(costParsed.message ?? "Invalid unit cost.");
      return;
    }
    if (qtyParsed.value === lot.qty_remaining && costParsed.value === lot.unit_cost) {
      setError("No changes to save.");
      return;
    }
    setPending(true);
    try {
      await updateLotAndSyncProduct(getDb(), productId, lot.id, {
        qty_remaining: qtyParsed.value,
        unit_cost: costParsed.value,
      });
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setError(null);
    const ok = window.confirm(
      "Delete this lot permanently? Product stock will be set to the sum of remaining lots. " +
        "Posted invoices that consumed this lot will still reference it in history.",
    );
    if (!ok) return;
    setDeletePending(true);
    try {
      await deleteLotAndSyncProduct(getDb(), productId, lot.id);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setDeletePending(false);
    }
  }

  async function handleConvertToStockIn() {
    setError(null);
    const ok = window.confirm(
      "Convert this lot source from opening_balance to stock_in? " +
        "It will start counting in stock purchases cash-outflow.",
    );
    if (!ok) return;
    setConvertPending(true);
    try {
      await convertOpeningBalanceLotToStockIn(getDb(), productId, lot.id);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setConvertPending(false);
    }
  }

  const busy = pending || deletePending || convertPending;

  return (
    <tr className="border-b border-border align-top">
      <td className="px-3 py-2 text-muted-foreground">{lot.source}</td>
      <td className="px-3 py-2 tabular-nums">{lot.qty_in}</td>
      <td className="px-3 py-2">
        <Input
          className="h-8 w-20 px-2 py-1 text-sm tabular-nums"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          aria-label={`Qty remaining for lot ${lot.id}`}
        />
      </td>
      <td className="px-3 py-2">
        <Input
          className="h-8 w-24 px-2 py-1 text-sm tabular-nums"
          inputMode="decimal"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          aria-label={`Unit cost for lot ${lot.id}`}
        />
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {formatDate(lot.received_at)}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1.5">
          <Button type="button" className="h-8 px-2 text-xs" disabled={busy} onClick={handleSave}>
            {pending ? "…" : "Save row"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8 border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive-muted"
            disabled={busy}
            onClick={handleDelete}
          >
            {deletePending ? "…" : "Delete lot"}
          </Button>
          {lot.source === "opening_balance" ? (
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2 text-xs"
              disabled={busy}
              onClick={handleConvertToStockIn}
            >
              {convertPending ? "…" : "Count as stock purchase"}
            </Button>
          ) : null}
          {error ? (
            <span className="text-[11px] text-destructive" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function ProductLotsModal({ row, onDismiss }: { row: ProductRow; onDismiss: () => void }) {
  const [lots, setLots] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncPending, setSyncPending] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ variant: "success" | "error"; text: string } | null>(
    null,
  );
  const [adjQty, setAdjQty] = useState("");
  const [adjCost, setAdjCost] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [adjPending, setAdjPending] = useState(false);
  const [adjError, setAdjError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      query(collection(db, COLLECTIONS.stockLots)),
      (snap) => {
        setLoadError(null);
        setLoading(false);
        const next: LotRow[] = [];
        snap.forEach((d) => {
          const data = d.data() as StockLotDoc;
          if (data.product_id === row.id) {
            next.push({ id: d.id, ...data });
          }
        });
        next.sort((a, b) => a.received_at.toMillis() - b.received_at.toMillis());
        setLots(next);
      },
      (err) => {
        setLoading(false);
        setLoadError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, [row.id]);

  const lotQtySum = useMemo(
    () =>
      lots.reduce((acc, l) => {
        const q = l.qty_remaining;
        return acc + (typeof q === "number" && Number.isInteger(q) ? q : 0);
      }, 0),
    [lots],
  );

  const mismatch = lotQtySum !== row.stock_quantity;

  async function handleSyncStock() {
    setSyncFeedback(null);
    setSyncPending(true);
    try {
      await syncProductStockFromLots(getDb(), row.id);
      setSyncFeedback({ variant: "success", text: "Product stock and cost now match lots." });
    } catch (e) {
      setSyncFeedback({ variant: "error", text: getFirestoreUserMessage(e) });
    } finally {
      setSyncPending(false);
    }
  }

  async function handleAdjustment(e: FormEvent) {
    e.preventDefault();
    setAdjError(null);
    const q = parsePositiveIntStrict(adjQty);
    if (!q.ok) {
      setAdjError(q.message ?? "Enter a positive whole number for quantity.");
      return;
    }
    const c = parseNonNegativeDecimal(adjCost);
    if (!c.ok) {
      setAdjError(c.message ?? "Invalid unit cost.");
      return;
    }
    setAdjPending(true);
    try {
      await createAdjustmentLot(getDb(), row.id, q.value, c.value, adjNote.trim() || undefined);
      setAdjQty("");
      setAdjCost("");
      setAdjNote("");
    } catch (err) {
      setAdjError(getFirestoreUserMessage(err));
    } finally {
      setAdjPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="product-lots-title"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="product-lots-title" className="text-lg font-semibold text-foreground">
          Inventory lots — {row.name}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          FIFO sales and stock out consume oldest lots first. You can edit unit cost and quantity
          remaining per lot. Receipt size (<code className="text-xs">qty_in</code>) and received
          date cannot be changed (Firestore rules). You can convert{" "}
          <code className="text-xs">opening_balance</code> to{" "}
          <code className="text-xs">stock_in</code> using the row action.{" "}
          <span className="text-destructive">
            Delete lot is temporary: use only for bad entries; product stock is re-synced from
            remaining lots.
          </span>
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            Product stock: <span className="tabular-nums text-foreground">{row.stock_quantity}</span>
          </span>
          <span className="text-muted-foreground">
            Sum of lots: <span className="tabular-nums text-foreground">{lotQtySum}</span>
          </span>
          <span className="text-muted-foreground">
            List cost: <span className="tabular-nums text-foreground">{formatMoney(row.cost_price)}</span>
          </span>
        </div>

        {mismatch ? (
          <InlineAlert variant="error" className="mt-3 text-sm">
            Lot quantities do not match product stock. Use &quot;Sync stock from lots&quot; to set product
            stock to the sum of lots (trust lots as truth), or adjust rows until they match.
          </InlineAlert>
        ) : null}

        {loadError ? (
          <InlineAlert variant="error" className="mt-3 text-sm">
            {loadError}
          </InlineAlert>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={syncPending} onClick={handleSyncStock}>
            {syncPending ? "Syncing…" : "Sync stock from lots"}
          </Button>
          <Button type="button" variant="outline" onClick={onDismiss}>
            Close
          </Button>
        </div>
        {syncFeedback ? (
          <InlineAlert variant={syncFeedback.variant} className="mt-2 text-sm">
            {syncFeedback.text}
          </InlineAlert>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading lots…</p>
        ) : lots.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            No stock lots for this product yet. Lots are created on stock in, invoice post (opening
            balance), or adjustment below.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Qty in</th>
                  <th className="px-3 py-2 font-semibold">Qty left</th>
                  <th className="px-3 py-2 font-semibold">Unit cost</th>
                  <th className="px-3 py-2 font-semibold">Received</th>
                  <th className="px-3 py-2 font-semibold"> </th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <LotEditRow key={lot.id} productId={row.id} lot={lot} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={handleAdjustment} className="mt-8 space-y-3 border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-foreground">Add adjustment lot</h3>
          <p className="text-xs text-muted-foreground">
            Adds units at a given cost when you cannot fix quantity using qty left alone (e.g. found
            stock). Increases product stock by this quantity.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="adj-qty" className="text-xs text-muted-foreground">
                Qty
              </Label>
              <Input
                id="adj-qty"
                className="h-9 w-24"
                inputMode="numeric"
                value={adjQty}
                onChange={(e) => setAdjQty(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="adj-cost" className="text-xs text-muted-foreground">
                Unit cost
              </Label>
              <Input
                id="adj-cost"
                className="h-9 w-28 tabular-nums"
                inputMode="decimal"
                value={adjCost}
                onChange={(e) => setAdjCost(e.target.value)}
              />
            </div>
            <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <Label htmlFor="adj-note" className="text-xs text-muted-foreground">
                Note (optional)
              </Label>
              <Input
                id="adj-note"
                className="h-9"
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
                placeholder="e.g. Stock count correction"
              />
            </div>
            <Button type="submit" disabled={adjPending}>
              {adjPending ? "Adding…" : "Add adjustment"}
            </Button>
          </div>
          {adjError ? (
            <InlineAlert variant="error" className="text-sm">
              {adjError}
            </InlineAlert>
          ) : null}
        </form>
      </div>
    </div>
  );
}
