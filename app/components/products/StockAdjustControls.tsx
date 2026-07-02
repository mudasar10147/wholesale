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
import { TraderSelectInput } from "@/app/components/products/TraderSelectInput";
import { cn } from "@/lib/utils";

type StockAdjustControlsProps = {
  productId: string;
  currentStock: number;
  /** Shown as default for the unit cost field; updates when the product row updates. */
  defaultUnitCost: number;
  pricingMode?: "manual" | "automatic";
};

function defaultCostInputString(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(n);
}

export function StockAdjustControls({
  productId,
  currentStock,
  defaultUnitCost,
  pricingMode = "manual",
}: StockAdjustControlsProps) {
  const [qty, setQty] = useState("1");
  const [unitCost, setUnitCost] = useState(() => defaultCostInputString(defaultUnitCost));
  const [traderId, setTraderId] = useState("");
  const [traderName, setTraderName] = useState("");
  /** Empty = do not change sale price on stock in. */
  const [salePriceInput, setSalePriceInput] = useState("");
  const [pending, setPending] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const alertId = `stock-adjust-alert-${productId}`;

  useEffect(() => {
    setUnitCost(defaultCostInputString(defaultUnitCost));
  }, [productId, defaultUnitCost]);

  useEffect(() => {
    setSalePriceInput("");
    setTraderId("");
    setTraderName("");
  }, [productId]);

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
    let salePrice: number | undefined;
    if (salePriceInput.trim() !== "") {
      const sp = parseNonNegativeDecimal(salePriceInput);
      if (!sp.ok) {
        setError(sp.message ?? "Invalid sale price.");
        return;
      }
      salePrice = sp.value;
    }
    if (!traderId) {
      setError("Trader (where purchased) is required.");
      return;
    }
    setPending("in");
    try {
      await stockIn(getDb(), productId, parsed.value, cost.value, salePrice, traderId, traderName);
      setSalePriceInput("");
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
  const shopId = `stock-shop-${productId}`;
  const saleId = `stock-sale-price-${productId}`;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={shopId}>Trader (where purchased)</Label>
        <TraderSelectInput
          id={shopId}
          value={traderId}
          onChange={(id, name) => {
            setTraderId(id);
            setTraderName(name);
          }}
          disabled={pending !== null}
          aria-invalid={!!error}
          aria-describedby={error ? alertId : undefined}
        />
      </div>

      <div className={cn("grid gap-3", pricingMode !== "automatic" ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={qtyId}>Quantity</Label>
          <Input
            id={qtyId}
            className="h-10 tabular-nums"
            inputMode="numeric"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? alertId : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={costId}>Unit cost</Label>
          <Input
            id={costId}
            className="h-10 tabular-nums"
            inputMode="decimal"
            min={0}
            step="any"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            aria-label="Purchase unit cost for stock in"
          />
        </div>
        {pricingMode !== "automatic" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={saleId}>Sale price</Label>
            <Input
              id={saleId}
              className="h-10 tabular-nums"
              inputMode="decimal"
              min={0}
              step="any"
              value={salePriceInput}
              onChange={(e) => setSalePriceInput(e.target.value)}
              placeholder="Optional"
              aria-label="Optional new sale price for stock in"
            />
          </div>
        ) : null}
      </div>

      <p className="text-xs leading-snug text-muted-foreground">
        {pricingMode === "automatic"
          ? "Receipt cost feeds FIFO lots; list sale price recalculates from target margin after stock in."
          : "Receipt cost feeds FIFO lots. Quantity and cost are required for stock in; sale price is optional and updates the product list price immediately (not per lot)."}
      </p>

      {error ? (
        <InlineAlert variant="error" id={alertId} className="text-sm">
          {error}
        </InlineAlert>
      ) : null}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button
          type="button"
          variant="primary"
          disabled={pending !== null}
          className="h-10"
          onClick={handleStockIn}
        >
          {pending === "in" ? "Stocking in…" : "Stock in"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={stockOutDisabled}
          className={cn(
            "h-10 text-destructive",
            "border-destructive/40 hover:bg-destructive-muted hover:text-destructive",
          )}
          onClick={handleStockOut}
        >
          {pending === "out" ? "Stocking out…" : "Stock out"}
        </Button>
      </div>
    </div>
  );
}
