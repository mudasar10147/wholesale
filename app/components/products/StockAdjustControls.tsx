"use client";

import { useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { stockIn, stockOut } from "@/lib/firestore/inventory";
import { parsePositiveIntStrict, validateQuantityAgainstStock } from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { cn } from "@/lib/utils";

type StockAdjustControlsProps = {
  productId: string;
  currentStock: number;
};

export function StockAdjustControls({ productId, currentStock }: StockAdjustControlsProps) {
  const [qty, setQty] = useState("1");
  const [pending, setPending] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const alertId = `stock-adjust-alert-${productId}`;

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
    setPending("in");
    try {
      await stockIn(getDb(), productId, parsed.value);
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

  return (
    <div className="flex min-w-[200px] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-9 w-[4.5rem] px-2 py-1.5 text-sm"
          inputMode="numeric"
          min={1}
          step={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          aria-label="Quantity to adjust"
          aria-invalid={!!error}
          aria-describedby={error ? alertId : undefined}
        />
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
      {error ? (
        <InlineAlert variant="error" id={alertId} className="max-w-[220px] text-xs">
          {error}
        </InlineAlert>
      ) : null}
    </div>
  );
}
