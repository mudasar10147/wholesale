"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  buildReorderRowsFromLowStock,
  createCustomReorderRow,
  sortReorderRowsByCategory,
  type ReorderListRow,
} from "@/lib/inventory/reorderList";
import { fetchAllStockLots } from "@/lib/inventory/reorderListPrices";
import type { LowStockProductRow } from "@/lib/inventory/lowStock";
import { downloadReorderListPdf } from "@/lib/pdf/reorderListPdf";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

function formatOptionalMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return formatMoney(value);
}

export type ReorderListModalProps = {
  open: boolean;
  onClose: () => void;
  threshold: number;
  products: LowStockProductRow[];
};

export function ReorderListModal({ open, onClose, threshold, products }: ReorderListModalProps) {
  const [rows, setRows] = useState<ReorderListRow[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pdfPending, setPdfPending] = useState(false);
  const [customName, setCustomName] = useState("");

  const productsRef = useRef(products);
  productsRef.current = products;

  const productSnapshotKey = useMemo(
    () => products.map((p) => `${p.id}:${p.stock_quantity}`).join("|"),
    [products],
  );

  // Single primitive dep — avoids React warning when an array was previously in the deps list.
  const reloadToken = open ? `open:${productSnapshotKey}` : "closed";

  const sortedRows = useMemo(() => sortReorderRowsByCategory(rows), [rows]);

  useEffect(() => {
    if (!reloadToken.startsWith("open:")) return;

    const currentProducts = productsRef.current;

    setCustomName("");
    setActionError(null);
    setLoadError(null);
    setLoadingPrices(true);

    let cancelled = false;

    void fetchAllStockLots(getDb())
      .then((lots) => {
        if (cancelled) return;
        setRows((prev) => {
          const customRows = prev.filter((row) => row.isCustom);
          return sortReorderRowsByCategory([
            ...buildReorderRowsFromLowStock(currentProducts, lots),
            ...customRows,
          ]);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(getFirestoreUserMessage(err));
        setRows((prev) => {
          const customRows = prev.filter((row) => row.isCustom);
          return sortReorderRowsByCategory([
            ...buildReorderRowsFromLowStock(currentProducts, []),
            ...customRows,
          ]);
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingPrices(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pdfPending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, pdfPending]);

  if (!open) return null;

  function handleAddCustom() {
    const trimmed = customName.trim();
    if (!trimmed) {
      setActionError("Enter a product name to add.");
      return;
    }
    setRows((prev) => sortReorderRowsByCategory([...prev, createCustomReorderRow(trimmed)]));
    setCustomName("");
    setActionError(null);
  }

  function handleRemoveRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
    setActionError(null);
  }

  async function handleDownloadPdf() {
    setActionError(null);
    if (sortedRows.length === 0) {
      setActionError("Add at least one product to the list.");
      return;
    }
    setPdfPending(true);
    try {
      await downloadReorderListPdf(sortedRows, {
        threshold,
        title: "Hall Road shopping list",
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not create PDF.");
    } finally {
      setPdfPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={() => {
        if (!pdfPending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="reorder-list-title"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-border bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-6 py-4">
          <h2 id="reorder-list-title" className="text-lg font-semibold text-foreground">
            Hall Road shopping list
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Products with stock ≤ {threshold}. Print or download the PDF and fill in new prices and
            quantities while purchasing.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loadError ? (
            <InlineAlert variant="error" className="mb-4">
              Could not load purchase history: {loadError}. Showing product list prices only.
            </InlineAlert>
          ) : null}

          {loadingPrices ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading purchase prices…
            </p>
          ) : sortedRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No products in this list. Adjust filters on the main page or add a custom product
              below.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2.5 font-semibold text-foreground">Product</th>
                    <th className="px-3 py-2.5 font-semibold text-foreground">Purchase price</th>
                    <th className="px-3 py-2.5 font-semibold text-foreground">Previous purchase</th>
                    <th className="px-3 py-2.5 font-semibold text-foreground">Last purchase</th>
                    <th className="px-3 py-2.5 font-semibold text-foreground">Stock</th>
                    <th className="px-3 py-2.5 font-semibold text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => (
                    <tr
                      key={row.key}
                      className={cn(
                        "border-b border-border last:border-b-0",
                        i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                      )}
                    >
                      <td className="px-3 py-2.5 font-medium text-foreground">
                        {row.name}
                        {row.isCustom ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            (custom)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-foreground">
                        {formatOptionalMoney(row.purchasePrice)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                        {formatOptionalMoney(row.previousPurchasePrice)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                        {formatOptionalMoney(row.lastPurchasePrice)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-foreground">
                        {row.stockQuantity.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 px-2.5 text-xs text-destructive"
                          onClick={() => handleRemoveRow(row.key)}
                          disabled={pdfPending}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-border bg-surface-muted/40 p-4">
            <p className="text-sm font-medium text-foreground">Add custom product</p>
            <p className="mt-1 text-xs text-muted-foreground">
              For items you want to buy at Hall Road that are not in your catalog.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1 space-y-1">
                <Label htmlFor="reorder-custom-name">Product name</Label>
                <Input
                  id="reorder-custom-name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. USB cable pack"
                  disabled={pdfPending}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustom();
                    }
                  }}
                />
              </div>
              <Button type="button" variant="outline" onClick={handleAddCustom} disabled={pdfPending}>
                Add product
              </Button>
            </div>
          </div>

          {actionError ? (
            <InlineAlert variant="error" className="mt-4">
              {actionError}
            </InlineAlert>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={pdfPending}>
            Close
          </Button>
          <Button type="button" onClick={handleDownloadPdf} disabled={pdfPending || loadingPrices}>
            {pdfPending ? "Preparing PDF…" : "Download PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}
