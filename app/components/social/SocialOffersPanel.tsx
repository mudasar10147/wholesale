"use client";

import { useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { deleteSocialOffer, isOfferLive, type SocialOfferRow } from "@/lib/firestore/socialOffers";
import { describeOffer } from "@/lib/social/captions";
import { toDateKey } from "@/lib/social/weekKeys";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";

type SocialOffersPanelProps = {
  offers: SocialOfferRow[];
  currencyPrefix: string;
  onCreate: () => void;
  onEdit: (offer: SocialOfferRow) => void;
  onChanged: () => void;
};

export function SocialOffersPanel({
  offers,
  currencyPrefix,
  onCreate,
  onEdit,
  onChanged,
}: SocialOffersPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const todayKey = toDateKey(new Date());

  async function onDelete(offer: SocialOfferRow) {
    setError(null);
    setDeletingId(offer.id);
    try {
      await deleteSocialOffer(getDb(), offer.id);
      onChanged();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Offers</CardTitle>
          <CardDescription>
            Discount campaigns you can attach to any planned post.
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={onCreate}>
          New offer
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

        {offers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
            No offers yet. Create one, or build one straight from the Dead &amp; aging tab in
            Suggestions.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {offers.map((offer) => {
              const live = isOfferLive(offer, todayKey);
              const discount = describeOffer(offer, currencyPrefix);
              return (
                <li key={offer.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{offer.title}</span>
                      {discount ? (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[0.6875rem] font-medium text-foreground">
                          {discount}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                          live
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-surface-muted text-muted-foreground",
                        )}
                      >
                        {live ? "Live" : offer.is_active ? "Scheduled" : "Inactive"}
                      </span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {offer.starts_on} → {offer.ends_on} · {offer.product_ids.length} product
                      {offer.product_ids.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => onEdit(offer)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={deletingId === offer.id}
                      onClick={() => void onDelete(offer)}
                    >
                      {deletingId === offer.id ? "Deleting…" : "Delete"}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
