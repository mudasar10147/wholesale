"use client";

import { useEffect } from "react";
import { TraderForm } from "@/app/components/traders/TraderForm";

type AddTraderModalProps = {
  onDismiss: () => void;
  /** Called with the new trader id and name after a successful create. */
  onCreated?: (traderId: string, name: string) => void;
};

export function AddTraderModal({ onDismiss, onCreated }: AddTraderModalProps) {
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
        aria-labelledby="add-trader-title"
        className="my-8 w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="add-trader-title" className="text-lg font-semibold text-foreground">
              Create new trader
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A trader is a supplier you buy stock from. Only the name is required.
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
        <TraderForm
          alertId="add-trader-alert"
          onSaved={(id, name) => {
            onCreated?.(id, name);
            onDismiss();
          }}
        />
      </div>
    </div>
  );
}
