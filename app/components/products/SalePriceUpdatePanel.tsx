"use client";

import { useMemo, useState } from "react";
import { type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { updateProductSalePrice } from "@/lib/firestore/products";
import { useActiveProducts } from "@/lib/firestore/referenceData";
import { useLiveOffers } from "@/lib/firestore/liveOffers";
import { marginPercent } from "@/lib/pricing/metrics";
import {
  belowCostConfirmMessage,
  describeSalePriceChange,
  matchesProductSearch,
  parseSalePriceInput,
  sortProductsByName,
  type SalePriceChange,
} from "@/lib/products/salePriceEdit";
import type { ProductDoc } from "@/lib/types/firestore";
import { OfferPriceText } from "@/app/components/pricing/OfferPriceText";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

type Row = ProductDoc & { id: string };

/** Four columns on a laptop; one stacked block on a phone. Shared by the headings and the rows. */
const COLUMNS = "sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_9rem_13rem] sm:gap-4";

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatPercent(n: number) {
  return `${n.toFixed(1)}%`;
}

/** The saved price, as the input should show it: "1350", never "1350.00" — see lineSeed.ts. */
function priceAsInputValue(price: number | undefined): string {
  return typeof price === "number" && Number.isFinite(price) ? String(price) : "";
}

/** "+150 (11.1%) · margin 33.3%" — what the typed price would do, before it is saved. */
function summariseChange(change: SalePriceChange): string {
  const size = `${change.delta > 0 ? "+" : "−"}${formatMoney(Math.abs(change.delta))}`;
  const percent =
    change.deltaPercent !== null ? ` (${formatPercent(Math.abs(change.deltaPercent))})` : "";
  const margin = change.belowCost
    ? " · below cost"
    : change.marginPercent !== null
      ? ` · margin ${formatPercent(change.marginPercent)}`
      : "";
  return `${size}${percent}${margin}`;
}

function formatUpdatedAt(ts: Timestamp | undefined): string | null {
  try {
    return ts ? ts.toDate().toLocaleDateString() : null;
  } catch {
    return null;
  }
}

/**
 * Re-pricing without buying: search a product, type its new sale price, save the row.
 *
 * The usual way a price changes is a stock-in — the receipt carries the new cost and the new
 * price together. A supplier can raise the cost of something the shop is not restocking
 * today, though, and until this tab existed there was nowhere to record that: the price sat
 * at its old figure, or a purchase had to be invented to move it.
 *
 * Rows are a responsive grid rather than a table on purpose. A table wide enough for these
 * columns has to be swiped sideways on a phone, which puts the box you are typing in and the
 * name of the product you are typing about on different screens.
 *
 * One product per save, deliberately. A price is a number somebody has thought about, not a
 * batch job, and the confirm on a below-cost price only means something if it names the one
 * product it is about.
 */
export function SalePriceUpdatePanel() {
  const { index: offerIndex } = useLiveOffers();
  const { rows: productRows, loading, error: loadError } = useActiveProducts();

  const [searchQuery, setSearchQuery] = useState("");
  /** Only the rows actually typed into — every other row reads straight from the saved price. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const rows = useMemo(
    () => sortProductsByName(productRows.map(({ id, data }) => ({ id, ...data }) as Row)),
    [productRows],
  );

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesProductSearch(row, searchQuery)),
    [rows, searchQuery],
  );

  function editRow(id: string, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: value }));
    // The "Saved" tag belongs to the price that is on screen; typing makes it stale.
    if (savedId === id) setSavedId(null);
    if (rowError?.id === id) setRowError(null);
  }

  async function handleSave(row: Row) {
    const typed = drafts[row.id] ?? priceAsInputValue(row.sale_price);
    const parsed = parseSalePriceInput(typed);
    if (!parsed.ok) {
      setRowError({ id: row.id, message: parsed.message ?? "Enter a sale price." });
      return;
    }
    const change = describeSalePriceChange({
      current: row.sale_price,
      next: parsed.value,
      cost: row.cost_price,
    });
    if (!change.changed) return;
    if (
      change.belowCost &&
      !window.confirm(belowCostConfirmMessage(row.name, change, row.cost_price))
    ) {
      return;
    }

    setRowError(null);
    setSavingId(row.id);
    try {
      await updateProductSalePrice(getDb(), row.id, change.next);
      // Drop the draft: the shared listener has the new price, so the input falls back to it
      // and the row stops looking half-edited.
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setSavedId(row.id);
    } catch (err) {
      setRowError({ id: row.id, message: getFirestoreUserMessage(err) });
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading products…
      </p>
    );
  }

  if (loadError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {loadError}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No products yet. Use Add product to create your first one.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Change what a product sells for without buying anything. Only the price moves — stock,
        cost and posted invoices stay exactly as they are, and drafts you have already written
        keep the price they were written with.
      </p>

      <div className="max-w-md">
        <Label htmlFor="sale-price-search" className="text-sm text-foreground">
          Search products
        </Label>
        <Input
          id="sale-price-search"
          type="search"
          className="mt-1.5 h-10"
          placeholder="Name or category"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSavedId(null);
          }}
          autoComplete="off"
          aria-describedby="sale-price-search-hint"
        />
        <p id="sale-price-search-hint" className="mt-1 text-[11px] text-muted-foreground">
          {filteredRows.length === rows.length
            ? `${rows.length} product${rows.length === 1 ? "" : "s"}`
            : `Showing ${filteredRows.length} of ${rows.length}`}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        {/* Column headings belong to the wide layout only — each phone row carries its own. */}
        <div
          className={cn(
            "hidden border-b border-border bg-surface-muted px-4 py-3 text-sm font-semibold text-foreground",
            COLUMNS,
          )}
        >
          <span>Product</span>
          <span>Cost</span>
          <span>Sale price now</span>
          <span>New sale price</span>
        </div>

        {filteredRows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {`No products match “${searchQuery.trim()}”. Try another search.`}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filteredRows.map((row) => {
              const cost = typeof row.cost_price === "number" ? row.cost_price : 0;
              const salePrice = typeof row.sale_price === "number" ? row.sale_price : 0;
              const currentMargin = marginPercent(salePrice, cost);
              const typed = drafts[row.id] ?? priceAsInputValue(row.sale_price);
              const parsed = parseSalePriceInput(typed);
              const change = parsed.ok
                ? describeSalePriceChange({ current: row.sale_price, next: parsed.value, cost })
                : null;
              const saving = savingId === row.id;
              const saveError = rowError?.id === row.id ? rowError.message : null;
              const updatedOn = formatUpdatedAt(row.pricing_updated_at);
              const offerPrice = offerIndex.price({
                id: row.id,
                salePrice: row.sale_price,
                createdAt: row.created_at,
              });
              const marginText =
                currentMargin !== null ? `Margin ${formatPercent(currentMargin)}` : "No margin";
              // A greyed-out Save with no explanation is the worst of both worlds, so the
              // parser's complaint shows as soon as it is typed — not only on submit.
              const note = saveError
                ? { text: saveError, bad: true, alert: true }
                : !parsed.ok
                  ? { text: parsed.message ?? "Enter a sale price.", bad: true, alert: false }
                  : change?.changed
                    ? { text: summariseChange(change), bad: change.belowCost, alert: false }
                    : savedId === row.id
                      ? { text: "Saved.", bad: false, alert: false }
                      : // Untouched rows stay quiet; the line is still drawn so nothing jumps
                        // when a message does appear.
                        { text: drafts[row.id] === undefined ? " " : "Unchanged.", bad: false, alert: false };

              return (
                <li key={row.id} className={cn("px-4 py-3 sm:items-start", COLUMNS)}>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.category ?? "No category"}
                      {updatedOn ? ` · price set ${updatedOn}` : ""}
                    </p>
                  </div>

                  <span className="hidden tabular-nums text-foreground sm:block">
                    {formatMoney(cost)}
                  </span>

                  <span className="hidden tabular-nums text-foreground sm:block">
                    <OfferPriceText price={offerPrice} format={formatMoney} />
                    <span className="mt-0.5 block text-xs text-muted-foreground">{marginText}</span>
                  </span>

                  {/* The same two figures, as a sentence, for the stacked phone layout. */}
                  <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                    Cost {formatMoney(cost)} · sells at{" "}
                    <OfferPriceText price={offerPrice} format={formatMoney} /> · {marginText.toLowerCase()}
                  </p>

                  <div className="mt-2 sm:mt-0">
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSave(row);
                      }}
                    >
                      <div className="w-28 shrink-0">
                        <Input
                          aria-label={`New sale price for ${row.name}`}
                          inputMode="decimal"
                          className="h-9 text-right tabular-nums"
                          value={typed}
                          onChange={(e) => editRow(row.id, e.target.value)}
                          disabled={saving}
                          aria-invalid={note.bad && !change?.belowCost}
                        />
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        className="h-9"
                        disabled={saving || !change?.changed}
                      >
                        {saving ? "Saving…" : "Save"}
                      </Button>
                    </form>
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        note.bad ? "text-destructive" : "text-muted-foreground",
                      )}
                      role={note.alert ? "alert" : undefined}
                    >
                      {note.text}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <InlineAlert variant="info">
        Cost comes from the last stock purchase and can’t be edited here — record a purchase to
        change it. A product on a live offer keeps showing the offer price; this sets the list
        price the offer comes off.
      </InlineAlert>
    </div>
  );
}
