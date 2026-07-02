"use client";

import { useEffect } from "react";
import { TraderForm, type TraderFormInitial } from "@/app/components/traders/TraderForm";

type TraderFormModalProps = {
  traderId?: string;
  initial?: TraderFormInitial;
  onDismiss: () => void;
  onSaved?: (traderId: string, name: string) => void;
};

export function TraderFormModal({
  traderId,
  initial,
  onDismiss,
  onSaved,
}: TraderFormModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const editing = !!traderId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="trader-form-title"
        className="my-8 w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="trader-form-title" className="text-lg font-semibold text-foreground">
              {editing ? "Edit trader" : "Create new trader"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {editing
                ? "Update this trader's contact details."
                : "A trader is a supplier you buy stock from. Only the name is required."}
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
          key={traderId ?? "new"}
          traderId={traderId}
          initial={initial}
          alertId="trader-form-modal-alert"
          onCancel={onDismiss}
          onSaved={(id, name) => {
            onSaved?.(id, name);
            onDismiss();
          }}
        />
      </div>
    </div>
  );
}
