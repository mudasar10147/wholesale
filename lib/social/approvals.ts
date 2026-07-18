import type { SocialWeekPlanStatus } from "@/lib/types/firestore";

/**
 * The approval loop for one week:
 *
 *   draft ──submit──▶ submitted ──approve──▶ approved
 *     ▲                   │                     │  ▲
 *     │                   ├─request changes─▶ changes_requested
 *     └──withdraw─────────┘                     │  │
 *     ▲                                         │  └── approve ──┐
 *     └──────────── reopen (admin) ─────────────┘                │
 *                                                                │
 *   approved ──"Make changes" (manager)──▶ revising ──submit──▶ submitted
 *
 * A week with no plan doc has never been submitted, so it reads as `draft`.
 *
 * `revising` is the answer to "the manager changed an approved week": the plan unlocks for
 * editing, but it stops being postable, so it has to go back through the admin. Every rule
 * below is mirrored in firestore.rules — the UI hides what the rules would reject anyway.
 */

export const WEEK_PLAN_STATUS_LABELS: Record<SocialWeekPlanStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved",
  changes_requested: "Changes requested",
  revising: "Being changed",
};

export const MAX_REVIEW_NOTE_LENGTH = 500;

/** A week nobody has submitted yet is a draft. */
export function weekPlanStatusOf(
  plan: { status: SocialWeekPlanStatus } | null,
): SocialWeekPlanStatus {
  return plan?.status ?? "draft";
}

/**
 * Content is frozen the moment a week is submitted — that is what makes the approval mean
 * something. Admins are never locked out: they are the ones who unlock it.
 */
export function canEditWeek(status: SocialWeekPlanStatus, isAdmin: boolean): boolean {
  return (
    isAdmin ||
    status === "draft" ||
    status === "changes_requested" ||
    status === "revising"
  );
}

/**
 * Ticking a post as Posted/Skipped is the one thing an approved week still allows — and the
 * only status that allows it. A week being revised has lost its approval and cannot go out.
 */
export function canMarkPosted(status: SocialWeekPlanStatus, isAdmin: boolean): boolean {
  return isAdmin || status === "approved";
}

/** Nothing to review in an empty week, so submitting one is not offered. */
export function canSubmitWeek(status: SocialWeekPlanStatus, postCount: number): boolean {
  return (
    postCount > 0 &&
    (status === "draft" || status === "changes_requested" || status === "revising")
  );
}

/** The manager can pull a week back while the admin has not acted on it yet. */
export function canWithdrawWeek(status: SocialWeekPlanStatus): boolean {
  return status === "submitted";
}

/**
 * The manager reopening an approved week to change something. It costs them the approval —
 * hence the confirmation in the UI, and hence `revising` rather than a silent edit.
 */
export function canReviseWeek(status: SocialWeekPlanStatus, isAdmin: boolean): boolean {
  return !isAdmin && status === "approved";
}

export function canReviewWeek(status: SocialWeekPlanStatus, isAdmin: boolean): boolean {
  return isAdmin && status === "submitted";
}

/** Only an admin can unlock an approved week for further edits. */
export function canReopenWeek(status: SocialWeekPlanStatus, isAdmin: boolean): boolean {
  return isAdmin && status === "approved";
}

/**
 * The statuses that put a week on the admin's radar. `submitted` is theirs to act on;
 * `revising` they cannot act on yet, but they need to know a week they signed off is being
 * changed underneath them — posts from it may already have gone out.
 */
export const WEEK_PLAN_REVIEW_STATUSES: readonly SocialWeekPlanStatus[] = [
  "submitted",
  "revising",
];
