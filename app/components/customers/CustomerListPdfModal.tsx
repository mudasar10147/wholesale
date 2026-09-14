"use client";

import { useEffect, useState } from "react";
import {
  CUSTOMER_PDF_COLUMN_LABELS,
  CUSTOMER_PDF_COLUMN_ORDER,
  DEFAULT_CUSTOMER_PDF_COLUMNS,
  type CustomerPdfColumn,
} from "@/lib/customers/customerListPdf";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

export type CustomerPdfChoices = {
  columns: CustomerPdfColumn[];
  includeArchived: boolean;
  onlyUnpaid: boolean;
};

/**
 * Rendered only while open, so each run starts from the default selection without an
 * effect resetting state after the fact — mounting is the reset.
 */
export type CustomerListPdfModalProps = {
  onClose: () => void;
  onConfirm: (choices: CustomerPdfChoices) => void;
  pending?: boolean;
  error?: string | null;
  /** Shown live so you can see the selection is not empty before generating. */
  matchCount?: (choices: Pick<CustomerPdfChoices, "includeArchived" | "onlyUnpaid">) => number;
};

export function CustomerListPdfModal({
  onClose,
  onConfirm,
  pending,
  error,
  matchCount,
}: CustomerListPdfModalProps) {
  const [selected, setSelected] = useState<Set<CustomerPdfColumn>>(
    () => new Set(DEFAULT_CUSTOMER_PDF_COLUMNS),
  );
  const [includeArchived, setIncludeArchived] = useState(false);
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  function toggle(column: CustomerPdfColumn) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
    setLocalError(null);
  }

  function handleConfirm() {
    const columns = CUSTOMER_PDF_COLUMN_ORDER.filter((c) => selected.has(c));
    if (columns.length === 0) {
      setLocalError("Tick at least one detail besides the customer name.");
      return;
    }
    onConfirm({ columns, includeArchived, onlyUnpaid });
  }

  const count = matchCount?.({ includeArchived, onlyUnpaid });
  const shown = error ?? localError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="customer-pdf-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="customer-pdf-title" className="text-lg font-semibold text-foreground">
          Download customer PDF
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The customer name is always included. Tick whatever else you need on this sheet.
        </p>

        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Details to include
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex cursor-not-allowed items-center gap-2.5 rounded-md border border-border bg-surface-muted/50 px-3 py-2 text-sm">
              <input type="checkbox" checked disabled className="size-4 rounded border-border" />
              <span className="font-medium text-foreground">Customer name</span>
            </label>
            {CUSTOMER_PDF_COLUMN_ORDER.map((column) => (
              <label
                key={column}
                className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-muted/50"
              >
                <input
                  type="checkbox"
                  className="size-4 rounded border-border"
                  checked={selected.has(column)}
                  disabled={pending}
                  onChange={() => toggle(column)}
                />
                <span className="text-foreground">{CUSTOMER_PDF_COLUMN_LABELS[column]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Which customers
          </legend>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-muted/50">
              <input
                type="checkbox"
                className="size-4 rounded border-border"
                checked={onlyUnpaid}
                disabled={pending}
                onChange={(e) => setOnlyUnpaid(e.target.checked)}
              />
              <span className="text-foreground">Only customers who still owe money</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-muted/50">
              <input
                type="checkbox"
                className="size-4 rounded border-border"
                checked={includeArchived}
                disabled={pending}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              <span className="text-foreground">Include archived customers</span>
            </label>
          </div>
          {typeof count === "number" ? (
            <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
              {count === 0
                ? "No customers match — the PDF would be empty."
                : `${count} customer${count === 1 ? "" : "s"} will be on the sheet.`}
            </p>
          ) : null}
        </fieldset>

        {shown ? (
          <InlineAlert variant="error" className="mt-4">
            {shown}
          </InlineAlert>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={pending || count === 0}>
            {pending ? "Preparing PDF…" : "Download PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}
