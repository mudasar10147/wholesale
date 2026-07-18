"use client";

import { useState } from "react";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { canEditWeek, weekPlanStatusOf } from "@/lib/social/approvals";
import type { SocialPostType } from "@/lib/social/postTypes";
import type { SocialProductRow } from "@/lib/social/types";
import { formatWeekRange, fromDateKey, toDateKey, weekDates } from "@/lib/social/weekKeys";
import { Button, ButtonLink } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { OfferFormModal, type OfferEditorTarget } from "@/app/components/social/OfferFormModal";
import { PostEditorModal, type PostEditorTarget } from "@/app/components/social/PostEditorModal";
import { PostTypePickerModal } from "@/app/components/social/PostTypePickerModal";
import { useSocialWeek } from "@/app/components/social/useSocialWeek";
import { WeekApprovalSection } from "@/app/components/social/WeekApprovalSection";
import { WeekPlannerBoard } from "@/app/components/social/WeekPlannerBoard";
import { WeeklyNotepad } from "@/app/components/social/WeeklyNotepad";

const DEFAULT_POST_TIME = "10:00";

/** Creating a post is two steps: which day and what type, then everything else. */
type PendingPost = { dateKey: string; time: string };

type WeekPlanBuilderProps = { weekKey: string };

/**
 * Where the week is actually built. The manager adds posts day by day, then sends the whole
 * week to an admin from the bar at the top. Copying posts and ticking them as sent is not
 * here — that is the daily job, and it lives back on the Social Media page.
 */
export function WeekPlanBuilder({ weekKey }: WeekPlanBuilderProps) {
  const { user, isAdmin } = useAuth();
  const uid = user?.uid ?? "";

  const week = useSocialWeek(weekKey);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingPost | null>(null);
  const [postTarget, setPostTarget] = useState<PostEditorTarget | null>(null);
  const [offerTarget, setOfferTarget] = useState<OfferEditorTarget | null>(null);

  const status = weekPlanStatusOf(week.plan);
  const editable = canEditWeek(status, isAdmin);

  /** Default a new post onto today when today is in this week, else onto the Monday. */
  function defaultDateKey(): string {
    const todayKey = toDateKey(new Date());
    const days = weekDates(weekKey).map(toDateKey);
    return days.includes(todayKey) ? todayKey : days[0]!;
  }

  function startPost(dateKey: string) {
    week.setError(null);
    setFeedback(null);
    setPending({ dateKey, time: DEFAULT_POST_TIME });
  }

  function pickType(type: SocialPostType) {
    if (!pending) return;
    setPostTarget({ mode: "create", type, dateKey: pending.dateKey, time: pending.time });
    setPending(null);
  }

  function openOfferFrom(products: SocialProductRow[]) {
    setPostTarget(null);
    setOfferTarget({ mode: "create", products });
  }

  const pendingDateLabel = pending
    ? (fromDateKey(pending.dateKey)?.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }) ?? pending.dateKey)
    : "";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Week plan"
        description={`${formatWeekRange(weekKey)} · ${weekKey}`}
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/social">← Back to Social Media</ButtonLink>
            <Button
              type="button"
              onClick={() => startPost(defaultDateKey())}
              disabled={!editable || week.loading}
              title={editable ? undefined : "This week is locked while it is with the admin."}
            >
              Create post
            </Button>
          </div>
        }
      />

      {week.error ? <InlineAlert variant="error">{week.error}</InlineAlert> : null}
      {feedback ? <InlineAlert variant="success">{feedback}</InlineAlert> : null}

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
      ) : (
        <WeekPlannerBoard
          weekKey={weekKey}
          posts={week.posts}
          productsById={week.productsById}
          editable={editable}
          onOpenPost={(post) => setPostTarget({ mode: "edit", post })}
          onAddPost={startPost}
        />
      )}

      {uid ? <WeeklyNotepad weekKey={weekKey} uid={uid} /> : null}

      {pending ? (
        <PostTypePickerModal
          dateLabel={pendingDateLabel}
          onPick={pickType}
          onDismiss={() => setPending(null)}
        />
      ) : null}

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
          onCreateOfferFrom={openOfferFrom}
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
