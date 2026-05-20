"use client";

import { useEffect, useState } from "react";
import {
  CATALOG_PDF_COLUMN_LABELS,
  CATALOG_PDF_COLUMN_ORDER,
  type CatalogPdfOptionalColumn,
} from "@/lib/share/salesCatalogPdf";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

const DEFAULT_COLUMNS: CatalogPdfOptionalColumn[] = ["purchase", "sale", "quantity"];

export type SalesCatalogPdfModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (columns: CatalogPdfOptionalColumn[]) => void;
  pending?: boolean;
};

export function SalesCatalogPdfModal({ open, onClose, onConfirm, pending }: SalesCatalogPdfModalProps) {
  const [selected, setSelected] = useState<Set<CatalogPdfOptionalColumn>>(() => new Set(DEFAULT_COLUMNS));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(DEFAULT_COLUMNS));
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, pending]);

  if (!open) return null;

  function toggle(column: CatalogPdfOptionalColumn) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
    setError(null);
  }

  function handleConfirm() {
    const columns = CATALOG_PDF_COLUMN_ORDER.filter((c) => selected.has(c));
    if (columns.length === 0) {
      setError("Select at least one column besides product name.");
      return;
    }
    onConfirm(columns);
  }

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
        aria-labelledby="catalog-pdf-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="catalog-pdf-title" className="text-lg font-semibold text-foreground">
          Download PDF
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Product name is always included. Choose which price and stock columns to export.
        </p>

        <fieldset className="mt-4 space-y-3">
          <legend className="sr-only">PDF columns</legend>
          <label className="flex cursor-not-allowed items-center gap-3 rounded-md border border-border bg-surface-muted/50 px-3 py-2.5 text-sm">
            <input type="checkbox" checked disabled className="size-4 rounded border-border" />
            <span className="font-medium text-foreground">Product name</span>
            <span className="text-xs text-muted-foreground">(required)</span>
          </label>
          {CATALOG_PDF_COLUMN_ORDER.map((column) => (
            <label
              key={column}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm hover:bg-surface-muted/50"
            >
              <input
                type="checkbox"
                className="size-4 rounded border-border"
                checked={selected.has(column)}
                disabled={pending}
                onChange={() => toggle(column)}
              />
              <span className="text-foreground">{CATALOG_PDF_COLUMN_LABELS[column]}</span>
            </label>
          ))}
        </fieldset>

        {error ? (
          <InlineAlert variant="error" className="mt-3">
            {error}
          </InlineAlert>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={pending}>
            {pending ? "Preparing PDF…" : "Download PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}
