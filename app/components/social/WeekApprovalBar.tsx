"use client";

import { useState } from "react";
import type { SocialWeekPlanRow } from "@/lib/firestore/socialWeekPlans";
import {
  canReopenWeek,
  canReviewWeek,
  canReviseWeek,
  canSubmitWeek,
  canWithdrawWeek,
  MAX_REVIEW_NOTE_LENGTH,
  WEEK_PLAN_STATUS_LABELS,
} from "@/lib/social/approvals";
import type { SocialWeekPlanStatus } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

const STATUS_CLASSES: Record<SocialWeekPlanStatus, string> = {
  draft: "border-border bg-surface",
  submitted: "border-blue-500/40 bg-blue-500/5",
  approved: "border-emerald-500/40 bg-emerald-500/5",
  changes_requested: "border-amber-500/40 bg-amber-500/5",
  revising: "border-amber-500/40 bg-amber-500/5",
};

const PILL_CLASSES: Record<SocialWeekPlanStatus, string> = {
  draft: "bg-surface-muted text-muted-foreground",
  submitted: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  changes_requested: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  revising: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
};

/** What the person looking at this week should do about it next. */
function statusHint(status: SocialWeekPlanStatus, isAdmin: boolean, postCount: number): string {
  switch (status) {
    case "draft":
      if (postCount === 0) {
        return "Nothing planned yet. Add the week's posts, then send it for approval.";
      }
      return isAdmin
        ? "The social manager has not sent this week for approval yet."
        : "Build the week, then send it to an admin for approval.";
    case "submitted":
      return isAdmin
        ? "Read through the week and approve it, or send it back with what needs changing."
        : "Sent for approval. The plan is locked until an admin looks at it.";
    case "approved":
      return isAdmin
        ? "Approved. The social manager is posting it — reopen the week to allow more edits."
        : "Approved — go ahead and post. To change anything, use Make changes; the week then has to be approved again.";
    case "changes_requested":
      return isAdmin
        ? "Sent back to the social manager. It will come back once they have fixed it."
        : "An admin sent this back. Fix the points below, then send it again.";
    case "revising":
      return isAdmin
        ? "The social manager reopened this week after you approved it. It is no longer approved, and nothing more can go out until they resend it and you sign it off."
        : "This week is no longer approved. Make your changes, then send it back for approval — you cannot post any of it until an admin signs it off again.";
  }
}

type WeekApprovalBarProps = {
  status: SocialWeekPlanStatus;
  plan: SocialWeekPlanRow | null;
  isAdmin: boolean;
  postCount: number;
  /** How many of this week's posts have already gone out — what a revision puts at risk. */
  postedCount: number;
  busy: boolean;
  onSubmit: () => void;
  onWithdraw: () => void;
  onApprove: () => void;
  onRequestChanges: (note: string) => void;
  onReopen: () => void;
  onRevise: () => void;
};

export function WeekApprovalBar({
  status,
  plan,
  isAdmin,
  postCount,
  postedCount,
  busy,
  onSubmit,
  onWithdraw,
  onApprove,
  onRequestChanges,
  onReopen,
  onRevise,
}: WeekApprovalBarProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const reviewNote = plan?.review_note?.trim();

  return (
    <section
      aria-label="Week approval"
      className={cn("space-y-3 rounded-lg border p-4", STATUS_CLASSES[status])}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[16rem] flex-1">
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
              PILL_CLASSES[status],
            )}
          >
            {WEEK_PLAN_STATUS_LABELS[status]}
          </span>
          <p className="mt-2 text-sm text-muted-foreground">
            {statusHint(status, isAdmin, postCount)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {!isAdmin && canSubmitWeek(status, postCount) ? (
            <Button type="button" disabled={busy} onClick={onSubmit}>
              {busy ? "Sending…" : "Send for approval"}
            </Button>
          ) : null}

          {!isAdmin && canWithdrawWeek(status) ? (
            <Button type="button" variant="outline" disabled={busy} onClick={onWithdraw}>
              Withdraw
            </Button>
          ) : null}

          {canReviseWeek(status, isAdmin) ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                // Reopening costs the week its approval, and posts may already have gone out
                // on the strength of it. Say so plainly before doing it.
                const warning =
                  postedCount > 0
                    ? `${postedCount} post${postedCount === 1 ? " has" : "s have"} already gone out from this week. `
                    : "";
                if (
                  window.confirm(
                    `${warning}Changing this week cancels its approval — you will not be able to post any more of it until an admin approves it again. Continue?`,
                  )
                ) {
                  onRevise();
                }
              }}
            >
              Make changes
            </Button>
          ) : null}

          {canReviewWeek(status, isAdmin) ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setNoteOpen((open) => !open)}
              >
                Request changes
              </Button>
              <Button type="button" disabled={busy} onClick={onApprove}>
                {busy ? "Saving…" : "Approve week"}
              </Button>
            </>
          ) : null}

          {canReopenWeek(status, isAdmin) ? (
            <Button type="button" variant="outline" disabled={busy} onClick={onReopen}>
              Reopen for editing
            </Button>
          ) : null}
        </div>
      </div>

      {/* The manager needs to read this every time they open the week, not just once. */}
      {status === "changes_requested" && reviewNote ? (
        <p className="rounded-md border border-amber-500/40 bg-surface px-3 py-2 text-sm text-foreground">
          <span className="font-medium">The admin asked for: </span>
          {reviewNote}
        </p>
      ) : null}

      {noteOpen && canReviewWeek(status, isAdmin) ? (
        <div className="space-y-2 border-t border-border pt-3">
          <Label htmlFor="review-note">What needs changing?</Label>
          <textarea
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={MAX_REVIEW_NOTE_LENGTH}
            placeholder="e.g. Drop the out-of-stock items from Friday, and price the shampoo at Rs. 260."
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setNoteOpen(false);
                setNote("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || note.trim().length === 0}
              onClick={() => {
                onRequestChanges(note);
                setNoteOpen(false);
                setNote("");
              }}
            >
              Send back
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
