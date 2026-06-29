"use client";

import { useEffect } from "react";
import { PartyForm, type PartyFormInitial } from "@/app/components/parties/PartyForm";

type AddPartyModalProps = {
  partyId?: string;
  initial?: PartyFormInitial;
  onDismiss: () => void;
  /** Called with the party id and name after a successful create/update. */
  onCreated?: (partyId: string, name: string) => void;
};

export function AddPartyModal({ partyId, initial, onDismiss, onCreated }: AddPartyModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const editing = !!partyId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="add-party-title"
        className="my-8 w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="add-party-title" className="text-lg font-semibold text-foreground">
              {editing ? "Edit party" : "Create new party"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A party is the person or company a cash entry comes from or goes to (owner, investor,
              lender, bank…). Only the name is required.
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
        <PartyForm
          partyId={partyId}
          initial={initial}
          alertId="add-party-alert"
          onSaved={(id, name) => {
            onCreated?.(id, name);
            onDismiss();
          }}
        />
      </div>
    </div>
  );
}
