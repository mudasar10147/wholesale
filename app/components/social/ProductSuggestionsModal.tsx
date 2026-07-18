"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSuggestions } from "@/lib/social/fetchSuggestions";
import { pickRandom } from "@/lib/social/pickProducts";
import { toPrice } from "@/lib/social/captions";
import {
  SUGGESTION_LENS_HINTS,
  SUGGESTION_LENS_LABELS,
  SUGGESTION_SOURCES,
  type SocialProductRow,
  type SuggestionLens,
  type SuggestionRow,
  type SuggestionSource,
} from "@/lib/social/types";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Select } from "@/app/components/ui/Select";
import { OutOfStockBadge, ProductThumb } from "@/app/components/social/SocialPrimitives";
import { NewArrivalBadge } from "@/app/components/products/NewArrivalBadge";
import { useNewArrivalSettings } from "@/lib/firestore/newArrivalSettings";
import { cn } from "@/lib/utils";

/** "Random" is a client-side shuffle of the product list; the rest come from the API. */
type Tab = SuggestionSource;

const TABS: readonly Tab[] = SUGGESTION_SOURCES;

const TAB_LABELS: Record<Tab, string> = {
  random: "Random",
  ...SUGGESTION_LENS_LABELS,
};

const TAB_HINTS: Record<Tab, string> = {
  random: "A fresh shuffle of everything you stock. Reload for a new set.",
  ...SUGGESTION_LENS_HINTS,
};

const RANDOM_SAMPLE_SIZE = 20;
const WINDOW_OPTIONS = [7, 14, 30, 60, 90];

type ProductSuggestionsModalProps = {
  allProducts: SocialProductRow[];
  /** Already on the post — shown as checked, and re-adding is a no-op. */
  selectedIds: string[];
  /** Shared in the last two weeks; surfaced so the same items are not spammed. */
  recentlyPostedIds: Set<string>;
  currencyPrefix: string;
  /** The tab they came from, so the post can record where its products were sourced. */
  onAdd: (products: SocialProductRow[], source: SuggestionSource) => void;
  onCreateOfferFrom: (products: SocialProductRow[]) => void;
  onDismiss: () => void;
};

export function ProductSuggestionsModal({
  allProducts,
  selectedIds,
  recentlyPostedIds,
  currencyPrefix,
  onAdd,
  onCreateOfferFrom,
  onDismiss,
}: ProductSuggestionsModalProps) {
  const { settings: newArrivalSettings } = useNewArrivalSettings();
  const [tab, setTab] = useState<Tab>("random");
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [randomSeed, setRandomSeed] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const loadRandom = useCallback(() => {
    setError(null);
    setLoading(false);
    setRows(
      pickRandom(allProducts, RANDOM_SAMPLE_SIZE).map((product) => ({
        ...product,
        metricLabel: product.stockQuantity > 0 ? `${product.stockQuantity} in stock` : "Out of stock",
        metricValue: product.stockQuantity,
      })),
    );
  }, [allProducts]);

  useEffect(() => {
    let active = true;
    if (tab === "random") {
      loadRandom();
      return;
    }

    async function load(lens: SuggestionLens) {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchSuggestions(lens, days);
        if (!active) return;
        setRows(result);
      } catch (err) {
        if (!active) return;
        setRows([]);
        setError(err instanceof Error ? err.message : "Could not load suggestions.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load(tab);
    return () => {
      active = false;
    };
  }, [tab, days, loadRandom, randomSeed]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(term));
  }, [rows, search]);

  const checkedProducts = useMemo(
    () => rows.filter((row) => checked.has(row.id)),
    [rows, checked],
  );

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="suggestions-title"
        className="my-8 w-full max-w-3xl rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="suggestions-title" className="text-lg font-semibold text-foreground">
              Pick products
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{TAB_HINTS[tab]}</p>
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

        <div className="flex flex-wrap gap-1 border-b border-border pb-3" role="tablist">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => setTab(item)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-fast)]",
                tab === item
                  ? "bg-surface-muted text-foreground"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {TAB_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 py-3">
          <div className="min-w-[12rem] flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name…"
              aria-label="Filter suggestions by name"
            />
          </div>
          {tab === "random" ? (
            <Button type="button" variant="outline" onClick={() => setRandomSeed((n) => n + 1)}>
              Reload
            </Button>
          ) : (
            <Select
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Time window"
              className="w-auto"
            >
              {WINDOW_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Last {option} days
                </option>
              ))}
            </Select>
          )}
        </div>

        {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground" role="status">
            Loading…
          </p>
        ) : null}

        {!loading && !error && visibleRows.length === 0 ? (
          <InlineAlert variant="info">
            Nothing to suggest here yet. Try a longer window or another tab.
          </InlineAlert>
        ) : null}

        {!loading && visibleRows.length > 0 ? (
          <ul className="max-h-[24rem] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {visibleRows.map((row) => {
              const isChecked = checked.has(row.id);
              const alreadyOnPost = selectedIds.includes(row.id);
              return (
                <li key={row.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-surface-hover",
                      isChecked && "bg-surface-muted",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(row.id)}
                      className="h-4 w-4 shrink-0"
                    />
                    <ProductThumb product={row} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{row.name}</span>
                        <NewArrivalBadge
                          createdAt={row.createdAtMs}
                          thresholdDays={newArrivalSettings.thresholdDays}
                        />
                        {row.stockQuantity <= 0 ? <OutOfStockBadge /> : null}
                        {alreadyOnPost ? (
                          <span className="text-xs text-muted-foreground">already added</span>
                        ) : null}
                        {recentlyPostedIds.has(row.id) ? (
                          <span className="text-xs text-amber-600 dark:text-amber-500">
                            posted recently
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted-foreground">{row.metricLabel}</span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-foreground">
                      {currencyPrefix} {toPrice(row.salePrice)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {checkedProducts.length} selected
          </p>
          <div className="flex flex-wrap gap-2">
            {tab === "aging_stock" ? (
              <Button
                type="button"
                variant="outline"
                disabled={checkedProducts.length === 0}
                onClick={() => onCreateOfferFrom(checkedProducts)}
              >
                Create offer from these
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={checkedProducts.length === 0}
              onClick={() => onAdd(checkedProducts, tab)}
            >
              Add {checkedProducts.length > 0 ? checkedProducts.length : ""} to post
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
