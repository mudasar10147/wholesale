"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { convertOpeningBalanceLotToStockIn } from "@/lib/firestore/lotAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { inventoryEngineConfig } from "@/lib/inventory/config";
import { postStockAdjustment } from "@/lib/inventory/stockAdjustment";
import { traderNameForLot, type TraderLookup } from "@/lib/inventory/traderLookup";
import type { ProductDoc, StockLotDoc } from "@/lib/types/firestore";
import { ConnectedNewArrivalBadge } from "@/app/components/products/NewArrivalBadge";
import {
  parseNonNegativeDecimal,
  parseNonNegativeIntStrict,
} from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { TraderSelectInput } from "@/app/components/products/TraderSelectInput";
import { useTraderLookup } from "@/app/components/traders/useTraderLookup";
import { cn } from "@/lib/utils";

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

function LotReadOnlyRow({
  productId,
  lot,
  traderLookup,
}: {
  productId: string;
  lot: LotRow;
  traderLookup: TraderLookup;
}) {
  const [convertPending, setConvertPending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertTraderId, setConvertTraderId] = useState("");
  const [convertTraderName, setConvertTraderName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleConfirmConvert() {
    setError(null);
    if (!convertTraderId) {
      setError("Select a trader (where purchased).");
      return;
    }
    setConvertPending(true);
    try {
      await convertOpeningBalanceLotToStockIn(
        getDb(),
        productId,
        lot.id,
        convertTraderId,
        convertTraderName,
      );
      setConverting(false);
      setConvertTraderId("");
      setConvertTraderName("");
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setConvertPending(false);
    }
  }

  return (
    <tr className="border-b border-border align-top">
      <td className="px-3 py-2 text-muted-foreground">{lot.source}</td>
      <td className="px-3 py-2 text-muted-foreground">
        {lot.source === "stock_in" ? traderNameForLot(lot, traderLookup) : "—"}
      </td>
      <td className="px-3 py-2 tabular-nums">{lot.qty_in}</td>
      <td className="px-3 py-2 tabular-nums font-medium">{lot.qty_remaining}</td>
      <td className="px-3 py-2 tabular-nums">{formatMoney(lot.unit_cost)}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {formatDate(lot.received_at)}
      </td>
      <td className="px-3 py-2">
        {lot.source === "opening_balance" ? (
          converting ? (
            <div className="flex flex-col gap-1.5">
              <TraderSelectInput
                id={`convert-trader-${lot.id}`}
                value={convertTraderId}
                onChange={(idV, name) => {
                  setConvertTraderId(idV);
                  setConvertTraderName(name);
                }}
                disabled={convertPending}
              />
              <div className="flex gap-1.5">
                <Button type="button" className="h-8 px-2 text-xs" disabled={convertPending} onClick={handleConfirmConvert}>
                  {convertPending ? "…" : "Confirm"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  disabled={convertPending}
                  onClick={() => setConverting(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" className="h-8 px-2 text-xs" onClick={() => setConverting(true)}>
              Count as stock purchase
            </Button>
          )
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        {error ? (
          <span className="mt-1 block text-[11px] text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function ProductLotsModal({ row, onDismiss }: { row: ProductRow; onDismiss: () => void }) {
  const [lots, setLots] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adjMode, setAdjMode] = useState<"add" | "remove">("add");
  const [adjQty, setAdjQty] = useState("");
  const [adjCost, setAdjCost] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjPending, setAdjPending] = useState(false);
  const [adjError, setAdjError] = useState<string | null>(null);
  const [adjSuccess, setAdjSuccess] = useState<string | null>(null);
  const traderLookup = useTraderLookup();

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
      query(collection(db, COLLECTIONS.stockLots), where("product_id", "==", row.id)),
      (snap) => {
        setLoadError(null);
        setLoading(false);
        const next: LotRow[] = [];
        snap.forEach((d) => {
          next.push({ id: d.id, ...(d.data() as StockLotDoc) });
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
  const gap = lotQtySum - row.stock_quantity;

  async function handleAdjustment(e: FormEvent) {
    e.preventDefault();
    setAdjError(null);
    setAdjSuccess(null);
    const q = parseNonNegativeIntStrict(adjQty);
    if (!q.ok || q.value <= 0) {
      setAdjError("Enter a positive whole number for quantity.");
      return;
    }
    const c = parseNonNegativeDecimal(adjCost);
    if (!c.ok) {
      setAdjError(c.message ?? "Invalid unit cost.");
      return;
    }
    const reason = adjReason.trim();
    if (!reason) {
      setAdjError("Reason is required for stock adjustments.");
      return;
    }
    const delta = adjMode === "add" ? q.value : -q.value;
    setAdjPending(true);
    try {
      await postStockAdjustment(getDb(), {
        productId: row.id,
        quantityDelta: delta,
        unitCost: c.value,
        reason,
      });
      setAdjQty("");
      setAdjCost("");
      setAdjReason("");
      setAdjSuccess("Stock adjustment posted.");
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
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="product-lots-title" className="text-lg font-semibold text-foreground">
              Inventory lots
            </h2>
            <p className="mt-1 flex items-center gap-2 truncate text-sm text-muted-foreground" title={row.name}>
              <span className="truncate">{row.name}</span>
              <ConnectedNewArrivalBadge createdAt={row.created_at} />
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="-mr-1 -mt-1 shrink-0 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface-muted/40 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Book stock</p>
            <p className="mt-1 tabular-nums text-lg font-semibold text-foreground">
              {row.stock_quantity.toLocaleString()}
            </p>
          </div>
          <div
            className={cn(
              "rounded-lg border px-4 py-3",
              mismatch ? "border-destructive/40 bg-destructive-muted/40" : "border-border bg-surface-muted/40",
            )}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sum of lots</p>
            <p className={cn("mt-1 tabular-nums text-lg font-semibold", mismatch ? "text-destructive" : "text-foreground")}>
              {lotQtySum.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-muted/40 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">List cost</p>
            <p className="mt-1 tabular-nums text-lg font-semibold text-foreground">{formatMoney(row.cost_price)}</p>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          FIFO layers are read-only. All quantity changes go through{" "}
          <strong className="font-medium text-foreground">stock adjustments</strong> (audited inventory
          transactions). Lot quantities update automatically when you post adjustments, stock in/out, or
          invoices.
        </p>

        {mismatch ? (
          <InlineAlert variant="error" className="mt-3 text-sm">
            Book stock and lots differ by {gap > 0 ? "+" : ""}
            {gap} units. Post a stock adjustment to correct — do not edit lots directly.
            {gap > 0 ? " Try removing stock with a reason." : " Try adding stock with a reason."}
          </InlineAlert>
        ) : null}

        {loadError ? (
          <InlineAlert variant="error" className="mt-3 text-sm">
            {loadError}
          </InlineAlert>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading lots…</p>
        ) : lots.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">No stock lots for this product yet.</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Trader</th>
                  <th className="px-3 py-2 font-semibold">Qty in</th>
                  <th className="px-3 py-2 font-semibold">Qty left</th>
                  <th className="px-3 py-2 font-semibold">Unit cost</th>
                  <th className="px-3 py-2 font-semibold">Received</th>
                  <th className="px-3 py-2 font-semibold"> </th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <LotReadOnlyRow key={lot.id} productId={row.id} lot={lot} traderLookup={traderLookup} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={handleAdjustment} className="mt-8 space-y-3 border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-foreground">Stock adjustment</h3>
          <p className="text-xs text-muted-foreground">
            Required reason is stored in the inventory transaction audit log.
            {inventoryEngineConfig.directLotEditsDisabled
              ? " Direct lot edits are disabled."
              : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={adjMode === "add" ? "primary" : "outline"}
              size="sm"
              onClick={() => setAdjMode("add")}
            >
              Add stock
            </Button>
            <Button
              type="button"
              variant={adjMode === "remove" ? "primary" : "outline"}
              size="sm"
              onClick={() => setAdjMode("remove")}
            >
              Remove stock
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="adj-qty" className="text-xs text-muted-foreground">
                Quantity
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
            <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
              <Label htmlFor="adj-reason" className="text-xs text-muted-foreground">
                Reason (required)
              </Label>
              <Input
                id="adj-reason"
                className="h-9"
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="e.g. Physical count correction"
                required
              />
            </div>
            <Button type="submit" disabled={adjPending}>
              {adjPending ? "Posting…" : "Post adjustment"}
            </Button>
          </div>
          {adjError ? <InlineAlert variant="error" className="text-sm">{adjError}</InlineAlert> : null}
          {adjSuccess ? <InlineAlert variant="success" className="text-sm">{adjSuccess}</InlineAlert> : null}
        </form>

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={onDismiss}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
