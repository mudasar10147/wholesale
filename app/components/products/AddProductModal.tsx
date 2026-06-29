"use client";

import { useEffect } from "react";
import { AddProductForm } from "@/app/components/products/AddProductForm";

export function AddProductModal({ onDismiss }: { onDismiss: () => void }) {
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
        aria-labelledby="add-product-title"
        className="my-8 w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="add-product-title" className="text-lg font-semibold text-foreground">
              Add product
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Name, cost, sale price, and initial purchase quantity. Quantity is recorded as a stock
              purchase. Category and image are optional.
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
        <AddProductForm onCreated={onDismiss} />
      </div>
    </div>
  );
}
