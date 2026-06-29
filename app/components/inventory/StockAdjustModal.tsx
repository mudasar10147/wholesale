"use client";

import { useEffect } from "react";
import { StockAdjustControls } from "@/app/components/products/StockAdjustControls";

export function StockAdjustModal({
  productId,
  productName,
  currentStock,
  defaultUnitCost,
  pricingMode = "manual",
  onDismiss,
}: {
  productId: string;
  productName: string;
  currentStock: number;
  defaultUnitCost: number;
  pricingMode?: "manual" | "automatic";
  onDismiss: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="stock-adjust-title"
        className="my-8 w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="stock-adjust-title" className="text-lg font-semibold text-foreground">
              Adjust stock
            </h2>
            <p className="mt-1 truncate text-sm text-muted-foreground" title={productName}>
              {productName} · {currentStock.toLocaleString()} on hand
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <StockAdjustControls
          productId={productId}
          currentStock={currentStock}
          defaultUnitCost={defaultUnitCost}
          pricingMode={pricingMode}
        />
      </div>
    </div>
  );
}
