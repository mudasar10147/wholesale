"use client";

import { useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { stockIn, stockOut } from "@/lib/firestore/inventory";
import {
  parseNonNegativeDecimal,
  parsePositiveIntStrict,
  validateQuantityAgainstStock,
} from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

type StockAdjustControlsProps = {
  productId: string;
  currentStock: number;
  /** Shown as default for the unit cost field; updates when the product row updates. */
  defaultUnitCost: number;
};

function defaultCostInputString(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(n);
}

export function StockAdjustControls({
  productId,
  currentStock,
  defaultUnitCost,
}: StockAdjustControlsProps) {
  const [qty, setQty] = useState("1");
  const [unitCost, setUnitCost] = useState(() => defaultCostInputString(defaultUnitCost));
  const [pending, setPending] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const alertId = `stock-adjust-alert-${productId}`;

  useEffect(() => {
    setUnitCost(defaultCostInputString(defaultUnitCost));
  }, [productId, defaultUnitCost]);

  const parsedQty = useMemo(() => parsePositiveIntStrict(qty), [qty]);
  const stockOutDisabled =
    pending !== null ||
    currentStock === 0 ||
    (parsedQty.ok && parsedQty.value > currentStock);

  async function handleStockIn() {
    setError(null);
    const parsed = parsePositiveIntStrict(qty);
    if (!parsed.ok) {
      setError(parsed.message ?? "Enter a positive whole number.");
      return;
    }
    const cost = parseNonNegativeDecimal(unitCost);
    if (!cost.ok) {
      setError(cost.message ?? "Invalid unit cost.");
      return;
    }
    setPending("in");
    try {
      await stockIn(getDb(), productId, parsed.value, cost.value);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setPending(null);
    }
  }

  async function handleStockOut() {
    setError(null);
    const parsed = parsePositiveIntStrict(qty);
    if (!parsed.ok) {
      setError(parsed.message ?? "Enter a positive whole number.");
      return;
    }
    const vs = validateQuantityAgainstStock(parsed.value, currentStock);
    if (!vs.ok) {
      setError(vs.message ?? "Not enough stock.");
      return;
    }
    setPending("out");
    try {
      await stockOut(getDb(), productId, parsed.value);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setPending(null);
    }
  }

  const qtyId = `stock-qty-${productId}`;
  const costId = `stock-unit-cost-${productId}`;

  return (
    <div className="flex min-w-[220px] max-w-[280px] flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={qtyId} className="text-xs text-muted-foreground">
            Qty
          </Label>
          <Input
            id={qtyId}
            className="h-9 w-[4.5rem] px-2 py-1.5 text-sm"
            inputMode="numeric"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? alertId : undefined}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={costId} className="text-xs text-muted-foreground">
            Unit cost
          </Label>
          <Input
            id={costId}
            className="h-9 w-[5.5rem] px-2 py-1.5 text-sm tabular-nums"
            inputMode="decimal"
            min={0}
            step="any"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            aria-label="Purchase unit cost for stock in"
          />
        </div>
        <Button
          type="button"
          variant="primary"
          disabled={pending !== null}
          className="h-9 px-3 py-1.5 text-xs"
          onClick={handleStockIn}
        >
          {pending === "in" ? "…" : "Stock in"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={stockOutDisabled}
          className={cn(
            "h-9 px-3 py-1.5 text-xs text-destructive",
            "border-destructive/40 hover:bg-destructive-muted hover:text-destructive",
          )}
          onClick={handleStockOut}
        >
          {pending === "out" ? "…" : "Stock out"}
        </Button>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Stock in uses this receipt&apos;s cost for FIFO. The product&apos;s default cost updates to match.
      </p>
      {error ? (
        <InlineAlert variant="error" id={alertId} className="max-w-[260px] text-xs">
          {error}
        </InlineAlert>
      ) : null}
    </div>
  );
}
