"use client";

import { useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { setSocialPostStatus, type SocialPostRow } from "@/lib/firestore/socialPosts";
import { canEditWeek, canMarkPosted, weekPlanStatusOf } from "@/lib/social/approvals";
import { productLine } from "@/lib/social/captions";
import { copyText } from "@/lib/social/clipboard";
import type { SocialProductRow } from "@/lib/social/types";
import { currentWeekKey, formatWeekRange, shiftWeekKey } from "@/lib/social/weekKeys";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { Button, ButtonLink } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { AdminReviewQueue } from "@/app/components/social/AdminReviewQueue";
import { OfferFormModal, type OfferEditorTarget } from "@/app/components/social/OfferFormModal";
import { PostEditorModal, type PostEditorTarget } from "@/app/components/social/PostEditorModal";
import { SocialOffersPanel } from "@/app/components/social/SocialOffersPanel";
import { useSocialReviewQueue } from "@/app/components/social/useSocialReviewQueue";
import { useSocialWeek } from "@/app/components/social/useSocialWeek";
import { WeekApprovalSection } from "@/app/components/social/WeekApprovalSection";
import { WeekPostList } from "@/app/components/social/WeekPostList";
import { cn } from "@/lib/utils";

type Tab = "planner" | "offers";

/**
 * The day-to-day surface: what is going out this week, copy it, tick it off. Building the
 * week happens on /social/plan/[weekKey] — the button in the header goes there.
 */
export function SocialPlannerPage() {
  const { user, isAdmin } = useAuth();
  const uid = user?.uid ?? "";

  const [tab, setTab] = useState<Tab>("planner");
  const [weekKey, setWeekKey] = useState(() => currentWeekKey());

  const week = useSocialWeek(weekKey);
  const reviewQueue = useSocialReviewQueue(isAdmin);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [postTarget, setPostTarget] = useState<PostEditorTarget | null>(null);
  const [offerTarget, setOfferTarget] = useState<OfferEditorTarget | null>(null);

  const status = weekPlanStatusOf(week.plan);
  const editable = canEditWeek(status, isAdmin);
  const markable = canMarkPosted(status, isAdmin);

  const postedCount = week.posts.filter((post) => post.status === "posted").length;
  const isCurrentWeek = weekKey === currentWeekKey();

  /**
   * An image- or video-only post has no message, so copying its caption would put an empty
   * string on the clipboard. Fall back to what the post actually carries: the video links,
   * else the product lines.
   */
  async function onCopyPost(post: SocialPostRow) {
    setFeedback(null);

    let text = post.caption.trim();
    if (!text && post.media_links.length > 0) {
      text = post.media_links.map((link) => link.url).join("\n");
    }
    if (!text) {
      text = post.product_ids
        .map((id) => week.productsById.get(id))
        .filter((product): product is SocialProductRow => Boolean(product))
        .map((product) => productLine(product, week.settings.currency_prefix))
        .join("\n");
    }
    if (!text) {
      setFeedback("This post has nothing to copy yet. Open it and add the photo, video or message.");
      return;
    }

    const ok = await copyText(text);
    setFeedback(ok ? "Copied. Paste it into the WhatsApp group." : "Could not copy text.");
  }

  async function onTogglePosted(post: SocialPostRow) {
    setBusyPostId(post.id);
    week.setError(null);
    try {
      await setSocialPostStatus(getDb(), post.id, post.status === "posted" ? "ready" : "posted");
      await week.reloadWeek();
    } catch (err) {
      week.setError(getFirestoreUserMessage(err));
    } finally {
      setBusyPostId(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Social Media"
        description="This week's WhatsApp posts. Copy each one when it is time to send, and tick it off."
        action={
          <ButtonLink href={`/social/plan/${weekKey}`} variant="primary">
            {week.posts.length === 0 ? "Create week plan" : "Open week plan"}
          </ButtonLink>
        }
      />

      {isAdmin ? <AdminReviewQueue plans={reviewQueue} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setWeekKey((key) => shiftWeekKey(key, -1))}
            aria-label="Previous week"
          >
            ‹
          </Button>
          <div className="min-w-[12rem] text-center">
            <p className="text-sm font-semibold text-foreground">{formatWeekRange(weekKey)}</p>
            <p className="text-xs text-muted-foreground">
              {weekKey} · {week.posts.length} planned · {postedCount} posted
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setWeekKey((key) => shiftWeekKey(key, 1))}
            aria-label="Next week"
          >
            ›
          </Button>
          {!isCurrentWeek ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setWeekKey(currentWeekKey())}
            >
              This week
            </Button>
          ) : null}
        </div>

        <div className="flex gap-1" role="tablist">
          {(["planner", "offers"] as const).map((item) => (
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
              {item === "planner" ? "This week" : "Offers"}
            </button>
          ))}
        </div>
      </div>

      {week.error ? <InlineAlert variant="error">{week.error}</InlineAlert> : null}
      {feedback ? <InlineAlert variant="success">{feedback}</InlineAlert> : null}

      {tab === "planner" ? (
        <div className="space-y-8">
          {uid ? (
            <WeekApprovalSection
              weekKey={weekKey}
              plan={week.plan}
              posts={week.posts}
              isAdmin={isAdmin}
              uid={uid}
              loading={week.loading}
              onChanged={week.reloadWeek}
              onFeedback={setFeedback}
              onError={week.setError}
            />
          ) : null}

          {week.loading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          ) : week.posts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">Nothing planned for this week yet.</p>
              <div className="mt-3">
                <ButtonLink href={`/social/plan/${weekKey}`} variant="primary">
                  Create week plan
                </ButtonLink>
              </div>
            </div>
          ) : (
            <WeekPostList
              posts={week.posts}
              productsById={week.productsById}
              busyPostId={busyPostId}
              editable={editable}
              markable={markable}
              onOpenPost={(post) => setPostTarget({ mode: "edit", post })}
              onCopyPost={(post) => void onCopyPost(post)}
              onTogglePosted={(post) => void onTogglePosted(post)}
            />
          )}
        </div>
      ) : (
        <SocialOffersPanel
          offers={week.offers}
          currencyPrefix={week.settings.currency_prefix}
          onCreate={() => setOfferTarget({ mode: "create", products: [] })}
          onEdit={(offer) => setOfferTarget({ mode: "edit", offer })}
          onChanged={() => void week.reloadOffers()}
        />
      )}

      {postTarget && uid ? (
        <PostEditorModal
          target={postTarget}
          weekKey={weekKey}
          allProducts={week.products}
          productsById={week.productsById}
          offers={week.offers}
          settings={week.settings}
          recentlyPostedIds={week.recentlyPostedIds}
          uid={uid}
          readOnly={!editable}
          onSaved={() => void week.reloadWeek()}
          onCreateOfferFrom={(products) => {
            setPostTarget(null);
            setOfferTarget({ mode: "create", products });
          }}
          onDismiss={() => setPostTarget(null)}
        />
      ) : null}

      {offerTarget && uid ? (
        <OfferFormModal
          target={offerTarget}
          allProducts={week.products}
          productsById={week.productsById}
          currencyPrefix={week.settings.currency_prefix}
          uid={uid}
          onSaved={() => void week.reloadOffers()}
          onDismiss={() => setOfferTarget(null)}
        />
      ) : null}
    </div>
  );
}
