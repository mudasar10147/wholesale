"use client";

import type { CustomerPurchaseLine } from "@/lib/firestore/customerPurchaseHistory";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { SearchableSelect, type SearchableOption } from "@/app/components/ui/SearchableSelect";
import { cn } from "@/lib/utils";
import type { ReturnLineDraft } from "@/app/components/invoices/useInvoiceReturnLines";

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export type PurchaseOption = SearchableOption & { line: CustomerPurchaseLine; name: string };

/** Returnable past purchases for the picker, labelled with the product name. */
export function buildPurchaseOptions(
  purchaseLines: readonly CustomerPurchaseLine[],
  productNameById: Map<string, string>,
): PurchaseOption[] {
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
}

export type InvoiceReturnLineRowProps = {
  row: ReturnLineDraft;
  /** 1-based position in the combined invoice line list. */
  position: number;
  options: PurchaseOption[];
  optionById: Map<string, PurchaseOption>;
  updateRow: (id: string, patch: Partial<Omit<ReturnLineDraft, "id" | "seq">>) => void;
  removeRow: (id: string) => void;
  disabled?: boolean;
};

/**
 * One return/discard row, rendered inline among the invoice's sale lines so the combined
 * list stays in the order the user added things.
 */
export function InvoiceReturnLineRow({
  row,
  position,
  options,
  optionById,
  updateRow,
  removeRow,
  disabled = false,
}: InvoiceReturnLineRowProps) {
  const opt = row.purchaseLineId ? optionById.get(row.purchaseLineId) : undefined;
  const pl = opt?.line;
  const qty = Number.parseInt(row.quantity.trim(), 10);
  const qtyValid = pl ? Number.isInteger(qty) && qty > 0 && qty <= pl.returnableQuantity : false;
  const lineCredit = pl && qtyValid && pl.soldQuantity > 0 ? (pl.lineTotal * qty) / pl.soldQuantity : 0;

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{position}.</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
            row.mode === "discard"
              ? "bg-red-500/10 text-red-600 dark:text-red-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-500",
          )}
        >
          {row.mode === "discard" ? "Discard" : "Return"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-12">
        <div className="space-y-1 sm:col-span-5">
          <SearchableSelect<PurchaseOption>
            options={options}
            value={row.purchaseLineId}
            onChange={(id) => updateRow(row.id, { purchaseLineId: id })}
            getDisplayValue={(o) => `${o.name} · ${o.line.orderId}`}
            renderOption={(o) => (
              <span className="flex flex-col">
                <span className="font-medium text-foreground">{o.name}</span>
                <span className="text-xs text-muted-foreground">
                  {o.line.orderId} · {o.line.returnableQuantity} returnable ·{" "}
                  {formatMoney(o.line.unitPrice)}/unit
                </span>
              </span>
            )}
            placeholder="Search a past purchase…"
            emptyText="No returnable past purchases for this customer."
            disabled={disabled}
            ariaLabel="Past purchase to return"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
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
        <div className="sm:col-span-3">
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
        <div className="flex items-start sm:col-span-2">
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive"
            disabled={disabled}
            onClick={() => removeRow(row.id)}
          >
            Remove
          </Button>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {pl ? (
          <>
            {pl.returnableQuantity} returnable ·{" "}
            {row.mode === "discard" ? "damaged, written off" : "back to stock"} · credit{" "}
            <span className="font-medium text-foreground">−{formatMoney(lineCredit)}</span>
          </>
        ) : (
          "Pick a past purchase to return, or remove this row."
        )}
      </p>
    </div>
  );
}
