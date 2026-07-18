"use client";

import { useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import type { SocialPostRow } from "@/lib/firestore/socialPosts";
import {
  approveSocialWeekPlan,
  requestSocialWeekPlanChanges,
  reopenSocialWeekPlan,
  reviseSocialWeekPlan,
  submitSocialWeekPlan,
  withdrawSocialWeekPlan,
  type SocialWeekPlanRow,
} from "@/lib/firestore/socialWeekPlans";
import { weekPlanStatusOf } from "@/lib/social/approvals";
import { WeekApprovalBar } from "@/app/components/social/WeekApprovalBar";

type WeekApprovalSectionProps = {
  weekKey: string;
  plan: SocialWeekPlanRow | null;
  posts: SocialPostRow[];
  isAdmin: boolean;
  uid: string;
  loading: boolean;
  /** Reload the week: the answer to "may I still edit this?" lives in the doc we just wrote. */
  onChanged: () => Promise<void>;
  onFeedback: (message: string | null) => void;
  onError: (message: string | null) => void;
};

/**
 * The approval bar, wired to Firestore. Both the overview and the plan builder show the
 * same week and offer the same actions on it, so the wiring lives here once.
 */
export function WeekApprovalSection({
  weekKey,
  plan,
  posts,
  isAdmin,
  uid,
  loading,
  onChanged,
  onFeedback,
  onError,
}: WeekApprovalSectionProps) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    onError(null);
    onFeedback(null);
    try {
      await action();
      await onChanged();
      onFeedback(done);
    } catch (err) {
      onError(err instanceof Error ? err.message : getFirestoreUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WeekApprovalBar
      status={weekPlanStatusOf(plan)}
      plan={plan}
      isAdmin={isAdmin}
      postCount={posts.length}
      postedCount={posts.filter((post) => post.status === "posted").length}
      busy={busy || loading}
      onSubmit={() =>
        void run(
          () => submitSocialWeekPlan(getDb(), weekKey, uid),
          "Sent to the admin. The plan is locked until they review it.",
        )
      }
      onWithdraw={() =>
        void run(
          () => withdrawSocialWeekPlan(getDb(), weekKey),
          "Pulled back. You can edit the week again.",
        )
      }
      onApprove={() =>
        void run(
          () => approveSocialWeekPlan(getDb(), weekKey, uid),
          "Week approved. The social manager can post it now.",
        )
      }
      onRequestChanges={(note) =>
        void run(
          () => requestSocialWeekPlanChanges(getDb(), weekKey, uid, note),
          "Sent back to the social manager with your note.",
        )
      }
      onReopen={() =>
        void run(
          () => reopenSocialWeekPlan(getDb(), weekKey, uid),
          "Week reopened. The social manager can edit it again.",
        )
      }
      onRevise={() =>
        void run(
          () => reviseSocialWeekPlan(getDb(), weekKey),
          "The week is open for changes. Send it back for approval when you are done — nothing more can go out until it is approved.",
        )
      }
    />
  );
}
