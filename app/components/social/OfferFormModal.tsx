"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  createSocialOffer,
  updateSocialOffer,
  type SocialOfferRow,
} from "@/lib/firestore/socialOffers";
import { toPrice } from "@/lib/social/captions";
import type { SocialProductRow } from "@/lib/social/types";
import { toDateKey } from "@/lib/social/weekKeys";
import type { SocialOfferDiscountType } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { SearchableSelect } from "@/app/components/ui/SearchableSelect";
import { Select } from "@/app/components/ui/Select";
import { ProductThumb } from "@/app/components/social/SocialPrimitives";
import { NewArrivalBadge } from "@/app/components/products/NewArrivalBadge";
import { useNewArrivalSettings } from "@/lib/firestore/newArrivalSettings";

export type OfferEditorTarget =
  | { mode: "edit"; offer: SocialOfferRow }
  /** Seeded from the aging-stock tab: "these are sitting — price them down". */
  | { mode: "create"; products: SocialProductRow[] };

type OfferFormModalProps = {
  target: OfferEditorTarget;
  allProducts: SocialProductRow[];
  productsById: Map<string, SocialProductRow>;
  currencyPrefix: string;
  uid: string;
  onSaved: () => void;
  onDismiss: () => void;
};

function defaultEndDate(): string {
  const end = new Date();
  end.setDate(end.getDate() + 7);
  return toDateKey(end);
}

export function OfferFormModal({
  target,
  allProducts,
  productsById,
  currencyPrefix,
  uid,
  onSaved,
  onDismiss,
}: OfferFormModalProps) {
  const existing = target.mode === "edit" ? target.offer : null;
  const { settings: newArrivalSettings } = useNewArrivalSettings();

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [discountType, setDiscountType] = useState<SocialOfferDiscountType>(
    existing?.discount_type ?? "percent",
  );
  const [discountValue, setDiscountValue] = useState(
    existing ? String(existing.discount_value) : "10",
  );
  const [startsOn, setStartsOn] = useState(existing?.starts_on ?? toDateKey(new Date()));
  const [endsOn, setEndsOn] = useState(existing?.ends_on ?? defaultEndDate());
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);
  const [appliesToAll, setAppliesToAll] = useState(existing?.applies_to_all ?? false);
  const [includesNewArrivals, setIncludesNewArrivals] = useState(
    existing?.includes_new_arrivals ?? false,
  );
  const [selected, setSelected] = useState<SocialProductRow[]>(() => {
    if (existing) {
      return existing.product_ids
        .map((id) => productsById.get(id))
        .filter((p): p is SocialProductRow => Boolean(p));
    }
    return target.mode === "create" ? target.products : [];
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const searchOptions = useMemo(
    () => allProducts.map((p) => ({ ...p, searchText: p.name.toLowerCase() })),
    [allProducts],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedDiscount = discountType === "none" ? 0 : Number(discountValue);
    if (discountType !== "none" && !Number.isFinite(parsedDiscount)) {
      setError("Enter a valid discount.");
      return;
    }

    setSubmitting(true);
    try {
      const input = {
        title,
        description,
        discountType,
        discountValue: parsedDiscount,
        // Kept whole even in sitewide mode, where it reads as the exclusion list — so
        // unticking restores exactly what was picked rather than losing it.
        productIds: selected.map((p) => p.id),
        appliesToAll,
        includesNewArrivals,
        startsOn,
        endsOn,
        isActive,
      };
      if (existing) {
        await updateSocialOffer(getDb(), existing.id, input);
      } else {
        await createSocialOffer(getDb(), input, uid);
      }
      onSaved();
      onDismiss();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="offer-form-title"
        className="my-8 w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="offer-form-title" className="text-lg font-semibold text-foreground">
              {existing ? "Edit offer" : "New offer"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Attach an offer to any planned post and its line is added to the message.
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

        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="offer-title">Title</Label>
            <Input
              id="offer-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Clearance week"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="offer-discount-type">Discount</Label>
              <Select
                id="offer-discount-type"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as SocialOfferDiscountType)}
              >
                <option value="percent">Percent off</option>
                <option value="flat">Flat amount off</option>
                <option value="none">No discount</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-discount-value">
                {discountType === "flat" ? `Amount (${currencyPrefix})` : "Percent"}
              </Label>
              <Input
                id="offer-discount-value"
                type="number"
                min="0"
                step="any"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                disabled={discountType === "none"}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="offer-starts">Starts</Label>
              <Input
                id="offer-starts"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-ends">Ends</Label>
              <Input
                id="offer-ends"
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offer-description">Description (optional)</Label>
            <textarea
              id="offer-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-surface-muted/40 p-3">
            <label className="flex items-start gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={appliesToAll}
                onChange={(e) => setAppliesToAll(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Apply to every product
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  A sitewide sale. Everything in the catalog is discounted, including products
                  added while it runs.
                </span>
              </span>
            </label>

            {appliesToAll ? (
              <label className="ml-6 flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={includesNewArrivals}
                  onChange={(e) => setIncludesNewArrivals(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  Include new arrivals
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    Off by default: products added in the last {newArrivalSettings.thresholdDays}{" "}
                    days stay at full price.
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          {appliesToAll && discountType !== "none" ? (
            <InlineAlert variant="warning">
              This changes the selling price of every product from {startsOn} to {endsOn}.
            </InlineAlert>
          ) : null}

          <div className="space-y-2">
            <Label>
              {appliesToAll ? `Excluded products (${selected.length})` : `Products (${selected.length})`}
            </Label>
            {appliesToAll ? (
              <p className="text-xs text-muted-foreground">
                Everything is on offer except what you list here.
              </p>
            ) : null}
            <SearchableSelect
              options={searchOptions}
              value=""
              onChange={(id) => {
                const product = productsById.get(id);
                if (!product) return;
                setSelected((prev) =>
                  prev.some((p) => p.id === product.id) ? prev : [...prev, product],
                );
              }}
              getDisplayValue={(option) => option.name}
              renderOption={(option) => (
                <span className="flex items-center justify-between gap-2">
                  <span>{option.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {currencyPrefix} {toPrice(option.salePrice)}
                  </span>
                </span>
              )}
              placeholder={
                appliesToAll ? "Exclude a product from this offer…" : "Add a product to this offer…"
              }
              ariaLabel={
                appliesToAll ? "Exclude a product from this offer" : "Add a product to this offer"
              }
            />
            {selected.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {selected.map((product) => (
                  <li key={product.id} className="flex items-center gap-3 px-3 py-2">
                    <ProductThumb product={product} size="sm" />
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-foreground">
                      <span className="truncate">{product.name}</span>
                      <NewArrivalBadge
                        createdAt={product.createdAtMs}
                        thresholdDays={newArrivalSettings.thresholdDays}
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelected((prev) => prev.filter((p) => p.id !== product.id))}
                      aria-label={`Remove ${product.name}`}
                      className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            Active — can be attached to posts
          </label>

          {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onDismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save offer"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
