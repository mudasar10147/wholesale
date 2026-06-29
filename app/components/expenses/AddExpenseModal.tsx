"use client";

import { useEffect } from "react";
import { AddExpenseForm } from "@/app/components/expenses/AddExpenseForm";

export function AddExpenseModal({ onDismiss }: { onDismiss: () => void }) {
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
        aria-labelledby="add-expense-title"
        className="my-8 w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="add-expense-title" className="text-lg font-semibold text-foreground">
              Add expense
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter a title and amount. The date is set automatically when you save.
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
        <AddExpenseForm onCreated={onDismiss} />
      </div>
    </div>
  );
}
