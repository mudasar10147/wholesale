"use client";

import { useMemo } from "react";
import type { CustomerPurchaseLine } from "@/lib/firestore/customerPurchaseHistory";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { SearchableSelect, type SearchableOption } from "@/app/components/ui/SearchableSelect";
import { cn } from "@/lib/utils";
import type { ReturnLineDraft } from "@/app/components/invoices/useInvoiceReturnLines";

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type PurchaseOption = SearchableOption & { line: CustomerPurchaseLine; name: string };

export type InvoiceReturnLinesSectionProps = {
  purchaseLines: CustomerPurchaseLine[];
  rows: ReturnLineDraft[];
  updateRow: (id: string, patch: Partial<Omit<ReturnLineDraft, "id">>) => void;
  removeRow: (id: string) => void;
  loading: boolean;
  error: string | null;
  productNameById: Map<string, string>;
  disabled?: boolean;
};

/**
 * Renders the return/discard rows added from the invoice line toolbar. The "Add return" and
 * "Add discard" buttons live next to "Add line" in the form — this only renders the rows.
 */
export function InvoiceReturnLinesSection({
  purchaseLines,
  rows,
  updateRow,
  removeRow,
  loading,
  error,
  productNameById,
  disabled = false,
}: InvoiceReturnLinesSectionProps) {
  const options: PurchaseOption[] = useMemo(() => {
    return purchaseLines
      .filter((l) => l.returnableQuantity > 0)
      .map((line) => {
        const name = productNameById.get(line.productId) ?? line.productId;
        return {
          id: line.invoiceItemId,
          searchText: `${name} ${line.orderId}`.toLowerCase(),
          line,
          name,
        };
      });
  }, [purchaseLines, productNameById]);

  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  if (rows.length === 0 && !error) return null;

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Returns &amp; discards — credit is deducted from this invoice.
      </p>
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {loading ? <p className="text-xs text-muted-foreground">Loading purchase history…</p> : null}

      {rows.map((row) => {
        const opt = row.purchaseLineId ? optionById.get(row.purchaseLineId) : undefined;
        const pl = opt?.line;
        const qty = Number.parseInt(row.quantity.trim(), 10);
        const qtyValid = pl ? Number.isInteger(qty) && qty > 0 && qty <= pl.returnableQuantity : false;
        const lineCredit =
          pl && qtyValid && pl.soldQuantity > 0 ? (pl.lineTotal * qty) / pl.soldQuantity : 0;
        return (
          <div key={row.id} className="grid grid-cols-12 items-end gap-2">
            <div className="col-span-12 sm:col-span-5">
              <SearchableSelect<PurchaseOption>
                options={options}
                value={row.purchaseLineId}
                onChange={(id) => updateRow(row.id, { purchaseLineId: id })}
                getDisplayValue={(o) => `${o.name} · ${o.line.orderId}`}
                renderOption={(o) => (
                  <span className="flex flex-col">
                    <span className="font-medium text-foreground">{o.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {o.line.orderId} · {o.line.returnableQuantity} returnable · {formatMoney(o.line.unitPrice)}/unit
                    </span>
                  </span>
                )}
                placeholder="Search a past purchase…"
                emptyText="No returnable past purchases for this customer."
                disabled={disabled}
                ariaLabel="Past purchase to return"
              />
            </div>
            <div className="col-span-4 sm:col-span-2">
              <Input
                type="text"
                inputMode="numeric"
                aria-label="Return quantity"
                value={row.quantity}
                onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                aria-invalid={Boolean(pl) && !qtyValid}
                disabled={disabled}
              />
            </div>
            <div className="col-span-5 sm:col-span-3">
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                {(["restock", "discard"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={disabled}
                    onClick={() => updateRow(row.id, { mode })}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                      row.mode === mode
                        ? "bg-surface-muted text-foreground"
                        : "text-muted-foreground hover:bg-surface-hover",
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div className="col-span-3 sm:col-span-2 flex items-center justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-9 px-2 py-1.5 text-xs text-destructive"
                disabled={disabled}
                onClick={() => removeRow(row.id)}
              >
                Remove
              </Button>
            </div>
            <div className="col-span-12 -mt-1 text-xs text-muted-foreground">
              {pl ? (
                <>
                  {pl.returnableQuantity} returnable ·{" "}
                  {row.mode === "discard" ? "damaged, written off" : "back to stock"} · credit{" "}
                  <span className="font-medium text-foreground">−{formatMoney(lineCredit)}</span>
                </>
              ) : (
                "Pick a past purchase to return, or remove this row."
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
