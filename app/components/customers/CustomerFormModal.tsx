"use client";

import { useEffect } from "react";
import { CustomerForm, type CustomerFormInitial } from "@/app/components/customers/CustomerForm";

type CustomerFormModalProps = {
  customerId?: string;
  initial?: CustomerFormInitial;
  onDismiss: () => void;
  onSaved?: (customerId: string, name: string) => void;
};

export function CustomerFormModal({
  customerId,
  initial,
  onDismiss,
  onSaved,
}: CustomerFormModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const editing = !!customerId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="customer-form-title"
        className="my-8 w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="customer-form-title" className="text-lg font-semibold text-foreground">
              {editing ? "Edit customer" : "Create new customer"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {editing
                ? "Update this customer's contact details."
                : "Add a customer for invoice-based sales tracking. Only the name is required."}
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
        <CustomerForm
          customerId={customerId}
          initial={initial}
          onSaved={(id, name) => {
            onSaved?.(id, name);
            onDismiss();
          }}
        />
      </div>
    </div>
  );
}
