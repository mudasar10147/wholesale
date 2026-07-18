"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  createSocialPost,
  deleteSocialPost,
  isValidMediaUrl,
  updateSocialPost,
  type SocialPostRow,
} from "@/lib/firestore/socialPosts";
import type { SocialOfferRow } from "@/lib/firestore/socialOffers";
import type { SocialMediaSettings } from "@/lib/firestore/socialSettings";
import { buildCaption, HEADLINE_BY_KIND, productLine, toPrice } from "@/lib/social/captions";
import { copyProductImage, copyText, IMAGE_COPY_FAILED_MESSAGE } from "@/lib/social/clipboard";
import {
  describePostGap,
  KIND_BY_SUGGESTION_SOURCE,
  MEDIA_SECTION_LABELS,
  POST_STATUS_LABELS,
  POST_STATUSES,
  postTypeOf,
  specOf,
  type SocialPostType,
} from "@/lib/social/postTypes";
import type { SocialProductRow } from "@/lib/social/types";
import { toDateKey, weekDates } from "@/lib/social/weekKeys";
import type { SocialMediaLink, SocialPostKind, SocialPostStatus } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { SearchableSelect } from "@/app/components/ui/SearchableSelect";
import { Select } from "@/app/components/ui/Select";
import {
  OutOfStockBadge,
  PostTypeBadge,
  ProductThumb,
  RecentlyPostedBadge,
} from "@/app/components/social/SocialPrimitives";
import { ProductSuggestionsModal } from "@/app/components/social/ProductSuggestionsModal";
import { NewArrivalBadge } from "@/app/components/products/NewArrivalBadge";
import { useNewArrivalSettings } from "@/lib/firestore/newArrivalSettings";

export type PostEditorTarget =
  | { mode: "edit"; post: SocialPostRow }
  | { mode: "create"; type: SocialPostType; dateKey: string; time: string };

type PostEditorModalProps = {
  target: PostEditorTarget;
  weekKey: string;
  allProducts: SocialProductRow[];
  productsById: Map<string, SocialProductRow>;
  offers: SocialOfferRow[];
  settings: SocialMediaSettings;
  recentlyPostedIds: Set<string>;
  uid: string;
  /**
   * The week is with the admin, or already signed off. The post opens for reading and
   * copying only — every way to change it is gone, and the rules would reject it anyway.
   */
  readOnly?: boolean;
  onSaved: () => void;
  onCreateOfferFrom: (products: SocialProductRow[]) => void;
  onDismiss: () => void;
};

/**
 * The one screen where a post is written. Its whole shape comes from the post's type — the
 * type is picked before this opens and cannot be changed here, so there is no way to build a
 * post that contradicts itself (an offer post with no offer, a photo post whose message and
 * offer are silently thrown away on save).
 */
export function PostEditorModal({
  target,
  weekKey,
  allProducts,
  productsById,
  offers,
  settings,
  recentlyPostedIds,
  uid,
  readOnly = false,
  onSaved,
  onCreateOfferFrom,
  onDismiss,
}: PostEditorModalProps) {
  const existing = target.mode === "edit" ? target.post : null;
  const { settings: newArrivalSettings } = useNewArrivalSettings();

  const type: SocialPostType =
    target.mode === "edit" ? postTypeOf(target.post) : target.type;
  const spec = specOf(type);
  const sections = spec.sections;

  const [dateKey, setDateKey] = useState(
    target.mode === "edit" ? target.post.scheduled_date : target.dateKey,
  );
  const [time, setTime] = useState(
    target.mode === "edit" ? target.post.scheduled_time : target.time,
  );
  const [kind, setKind] = useState<SocialPostKind>(existing ? existing.kind : spec.defaultKind);
  const [status, setStatus] = useState<SocialPostStatus>(existing ? existing.status : "draft");
  const [selected, setSelected] = useState<SocialProductRow[]>(() => {
    if (!existing) return [];
    return existing.product_ids
      .map((id) => productsById.get(id))
      .filter((p): p is SocialProductRow => Boolean(p));
  });
  const [offerId, setOfferId] = useState(existing?.offer_id ?? "");
  // Null means "nobody has written anything here yet", so the message tracks the products,
  // kind and offer as they change. The first keystroke pins it; Regenerate un-pins it.
  const [captionOverride, setCaptionOverride] = useState<string | null>(
    existing?.caption ? existing.caption : null,
  );
  const [mediaLinks, setMediaLinks] = useState<SocialMediaLink[]>(existing?.media_links ?? []);
  const [note, setNote] = useState(existing?.note ?? "");

  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");

  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedIds = useMemo(() => selected.map((p) => p.id), [selected]);
  const offer = useMemo(() => offers.find((o) => o.id === offerId) ?? null, [offers, offerId]);

  const outOfStock = useMemo(() => selected.filter((p) => p.stockQuantity <= 0), [selected]);
  const repeats = useMemo(
    () => selected.filter((p) => recentlyPostedIds.has(p.id)),
    [selected, recentlyPostedIds],
  );

  const composedCaption = useMemo(
    () =>
      buildCaption({
        // A message-only post carries no product list, so the generated text is just the
        // headline and the footer — the words are the manager's to write.
        products: sections.products ? selected : [],
        offer: sections.offer ? offer : null,
        headline: HEADLINE_BY_KIND[kind],
        currencyPrefix: settings.currency_prefix,
        footerLine: settings.footer_line,
      }),
    [
      sections.products,
      sections.offer,
      selected,
      offer,
      kind,
      settings.currency_prefix,
      settings.footer_line,
    ],
  );

  const caption = captionOverride ?? composedCaption;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !suggestionsOpen) onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss, suggestionsOpen]);

  // What this post still needs before it can go out. Null means it is ready.
  const gap = describePostGap(type, {
    products: sections.products ? selected.length : 0,
    mediaLinks: sections.media ? mediaLinks.length : 0,
    captionLength: sections.message ? caption.trim().length : 0,
    hasOffer: sections.offer ? Boolean(offer) : false,
  });

  // A post belongs to the week it was planned in; letting the date wander out of it would
  // file the post under a week it no longer appears in.
  const days = useMemo(() => weekDates(weekKey), [weekKey]);
  const minDate = toDateKey(days[0]!);
  const maxDate = toDateKey(days[6]!);

  function addProducts(products: SocialProductRow[]) {
    setSelected((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...products.filter((p) => !seen.has(p.id))];
    });
  }

  function removeProduct(id: string) {
    setSelected((prev) => prev.filter((p) => p.id !== id));
  }

  /**
   * Picking the offer brings its products with it — that is what the post is advertising.
   * Done here on the change rather than in an effect, so removing one afterwards sticks.
   */
  function onPickOffer(nextOfferId: string) {
    setOfferId(nextOfferId);
    const picked = offers.find((o) => o.id === nextOfferId);
    if (!picked) return;
    const products = picked.product_ids
      .map((id) => productsById.get(id))
      .filter((p): p is SocialProductRow => Boolean(p));
    addProducts(products);
  }

  function addMediaLink() {
    const url = linkUrl.trim();
    if (!url) return;
    if (!isValidMediaUrl(url)) {
      setError("Media links must start with http:// or https://.");
      return;
    }
    setError(null);
    const label = linkLabel.trim();
    setMediaLinks((prev) => [...prev, label ? { url, label } : { url }]);
    setLinkUrl("");
    setLinkLabel("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await save();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
      setSubmitting(false);
    }
  }

  async function save() {
    const input = {
      weekKey,
      scheduledDate: dateKey,
      scheduledTime: time,
      kind,
      // The type owns the format. A legacy `image`/`video` post normalizes on the way out.
      format: spec.format,
      status,
      // Sections this type does not have are stored empty, so nothing carries a value the
      // editor never showed.
      caption: sections.message ? caption : "",
      productIds: sections.products ? selectedIds : [],
      offerId: sections.offer && offerId ? offerId : undefined,
      mediaLinks: sections.media ? mediaLinks : [],
      note,
    };
    if (existing) {
      await updateSocialPost(getDb(), existing.id, input);
    } else {
      await createSocialPost(getDb(), input, uid);
    }
    onSaved();
    onDismiss();
  }

  async function onDelete() {
    if (!existing) return;
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteSocialPost(getDb(), existing.id);
      onSaved();
      onDismiss();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
      setSubmitting(false);
    }
  }

  async function onCopyCaption() {
    setFeedback(null);
    const ok = await copyText(caption);
    setFeedback(ok ? "Message copied." : "Could not copy text. Please copy manually.");
  }

  async function onCopyProductText(product: SocialProductRow) {
    setFeedback(null);
    const ok = await copyText(productLine(product, settings.currency_prefix));
    setFeedback(
      ok ? `Copied text for ${product.name}.` : "Could not copy text. Please copy manually.",
    );
  }

  async function onCopyImage(product: SocialProductRow) {
    setFeedback(null);
    const ok = await copyProductImage(product);
    setFeedback(ok ? `Copied image for ${product.name}.` : IMAGE_COPY_FAILED_MESSAGE);
  }

  async function onCopyLink(url: string) {
    setFeedback(null);
    const ok = await copyText(url);
    setFeedback(ok ? "Link copied." : "Could not copy the link. Please copy manually.");
  }

  const liveOffers = useMemo(() => offers.filter((o) => o.is_active), [offers]);
  /** Only a post that sends a photo has an image worth copying. */
  const showImageCopy = spec.format === "image_text";

  const searchOptions = useMemo(
    () =>
      allProducts.map((product) => ({
        ...product,
        searchText: product.name.toLowerCase(),
      })),
    [allProducts],
  );

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
        role="presentation"
        onClick={onDismiss}
      >
        <div
          role="dialog"
          aria-modal
          aria-labelledby="post-editor-title"
          className="my-8 w-full max-w-2xl rounded-lg border border-border bg-surface p-6 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="post-editor-title" className="text-lg font-semibold text-foreground">
                  {readOnly ? spec.label : existing ? `Edit ${spec.label.toLowerCase()}` : spec.label}
                </h2>
                <PostTypeBadge type={type} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {readOnly
                  ? "This week is locked. Copy the message and the images, and send them as planned."
                  : spec.hint}
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="post-date">Date</Label>
                <Input
                  id="post-date"
                  type="date"
                  value={dateKey}
                  min={minDate}
                  max={maxDate}
                  onChange={(e) => setDateKey(e.target.value)}
                  disabled={readOnly}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="post-time">Time</Label>
                <Input
                  id="post-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={readOnly}
                  required
                />
              </div>
            </div>

            {sections.offer ? (
              <div className="space-y-2">
                <Label htmlFor="post-offer">Offer</Label>
                <Select
                  id="post-offer"
                  value={offerId}
                  disabled={readOnly}
                  onChange={(e) => onPickOffer(e.target.value)}
                >
                  <option value="">Pick an offer…</option>
                  {liveOffers.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title} (till {option.ends_on})
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  {liveOffers.length === 0
                    ? "No active offers yet. Create one on the Offers tab first."
                    : "The offer's products are added to the post automatically. Remove any you do not want."}
                </p>
              </div>
            ) : null}

            {sections.products ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>
                    Products ({selected.length})
                    {type === "video" ? (
                      <span className="ml-1 font-normal text-muted-foreground">optional</span>
                    ) : null}
                  </Label>
                  {readOnly ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSuggestionsOpen(true)}
                    >
                      Suggestions
                    </Button>
                  )}
                </div>

                {readOnly ? null : (
                  <SearchableSelect
                    options={searchOptions}
                    value=""
                    onChange={(id) => {
                      const product = productsById.get(id);
                      if (product) addProducts([product]);
                    }}
                    getDisplayValue={(option) => option.name}
                    renderOption={(option) => (
                      <span className="flex items-center justify-between gap-2">
                        <span>{option.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {settings.currency_prefix} {toPrice(option.salePrice)}
                        </span>
                      </span>
                    )}
                    placeholder="Search a product to add…"
                    ariaLabel="Search a product to add"
                  />
                )}

                {outOfStock.length > 0 ? (
                  <InlineAlert variant="warning">
                    {outOfStock.length === 1
                      ? `${outOfStock[0]!.name} is out of stock.`
                      : `${outOfStock.length} selected products are out of stock.`}{" "}
                    Remove them, or restock before posting.
                  </InlineAlert>
                ) : null}
                {repeats.length > 0 ? (
                  <InlineAlert variant="info">
                    {repeats.length === 1
                      ? `${repeats[0]!.name} was already shared in the last two weeks.`
                      : `${repeats.length} of these were already shared in the last two weeks.`}
                  </InlineAlert>
                ) : null}

                {selected.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                    {readOnly
                      ? "No products on this post."
                      : "No products yet. Search above, or open Suggestions for the best sellers, new arrivals, aging stock or a random set."}
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {selected.map((product) => (
                      <li key={product.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <ProductThumb product={product} size="sm" />
                        <span className="min-w-[8rem] flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {product.name}
                            </span>
                            <NewArrivalBadge
                              createdAt={product.createdAtMs}
                              thresholdDays={newArrivalSettings.thresholdDays}
                            />
                            {product.stockQuantity <= 0 ? <OutOfStockBadge /> : null}
                            {recentlyPostedIds.has(product.id) ? <RecentlyPostedBadge /> : null}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {settings.currency_prefix} {toPrice(product.salePrice)} ·{" "}
                            {product.stockQuantity} in stock
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void onCopyProductText(product)}
                        >
                          Copy text
                        </Button>
                        {showImageCopy ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void onCopyImage(product)}
                          >
                            Copy image
                          </Button>
                        ) : null}
                        {readOnly ? null : (
                          <button
                            type="button"
                            onClick={() => removeProduct(product.id)}
                            aria-label={`Remove ${product.name}`}
                            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {sections.media ? (
              <div className="space-y-2">
                <Label>{MEDIA_SECTION_LABELS[type]}</Label>
                {mediaLinks.length > 0 ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {mediaLinks.map((link, index) => (
                      <li key={`${link.url}-${index}`} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="block truncate text-sm text-foreground underline underline-offset-2"
                          >
                            {link.label || link.url}
                          </a>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void onCopyLink(link.url)}
                        >
                          Copy link
                        </Button>
                        {readOnly ? null : (
                          <button
                            type="button"
                            onClick={() =>
                              setMediaLinks((prev) => prev.filter((_, i) => i !== index))
                            }
                            aria-label="Remove link"
                            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {readOnly ? null : (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://drive.google.com/…"
                      aria-label="Media link URL"
                      className="min-w-[14rem] flex-1"
                    />
                    <Input
                      value={linkLabel}
                      onChange={(e) => setLinkLabel(e.target.value)}
                      placeholder="Label (optional)"
                      aria-label="Media link label"
                      className="w-40"
                    />
                    <Button type="button" variant="outline" onClick={addMediaLink}>
                      Add link
                    </Button>
                  </div>
                )}
              </div>
            ) : null}

            {sections.message ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="post-caption">
                    Message
                    {type === "video" ? (
                      <span className="ml-1 font-normal text-muted-foreground">optional</span>
                    ) : null}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {readOnly ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCaptionOverride(null)}
                      >
                        Regenerate
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onCopyCaption()}
                    >
                      Copy text
                    </Button>
                  </div>
                </div>
                <textarea
                  id="post-caption"
                  value={caption}
                  onChange={(e) => setCaptionOverride(e.target.value)}
                  readOnly={readOnly}
                  rows={10}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {sections.products && !readOnly ? (
                  <p className="text-xs text-muted-foreground">
                    Written for you from the products above, until you type in it. Regenerate
                    builds it again.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="post-note">Note (optional)</Label>
              <textarea
                id="post-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                readOnly={readOnly}
                rows={2}
                placeholder="Anything to remember about this post…"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="post-status">Status</Label>
              <Select
                id="post-status"
                value={status}
                disabled={readOnly}
                onChange={(e) => setStatus(e.target.value as SocialPostStatus)}
              >
                {POST_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {POST_STATUS_LABELS[option]}
                  </option>
                ))}
              </Select>
            </div>

            {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
            {feedback ? <InlineAlert variant="success">{feedback}</InlineAlert> : null}
            {gap && !readOnly ? <InlineAlert variant="info">{gap}</InlineAlert> : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                {existing && !readOnly ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={submitting}
                    onClick={() => void onDelete()}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={onDismiss}>
                  {readOnly ? "Close" : "Cancel"}
                </Button>
                {readOnly ? null : (
                  <Button type="submit" disabled={submitting || Boolean(gap)}>
                    {submitting ? "Saving…" : "Save post"}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>

      {suggestionsOpen ? (
        <ProductSuggestionsModal
          allProducts={allProducts}
          selectedIds={selectedIds}
          recentlyPostedIds={recentlyPostedIds}
          currencyPrefix={settings.currency_prefix}
          onAdd={(products, source) => {
            addProducts(products);
            // Record where they came from, so the post carries the badge. An offer post is
            // always "offer" — its products are the offer's, whatever tab they arrived on.
            if (spec.sourcedKind) {
              setKind(KIND_BY_SUGGESTION_SOURCE[source]);
            }
            setSuggestionsOpen(false);
          }}
          onCreateOfferFrom={(products) => {
            setSuggestionsOpen(false);
            onCreateOfferFrom(products);
          }}
          onDismiss={() => setSuggestionsOpen(false)}
        />
      ) : null}
    </>
  );
}
