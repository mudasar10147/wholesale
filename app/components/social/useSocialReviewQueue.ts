"use client";

import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import {
  watchSocialWeekPlansForReview,
  type SocialWeekPlanRow,
} from "@/lib/firestore/socialWeekPlans";

/**
 * The weeks on an admin's radar, live. This is the app's only notification: when a manager
 * sends a week for approval — or reopens one that was already approved — it shows up here,
 * on the Social Media page and as a count on the sidebar link.
 *
 * Only admins are subscribed. For everyone else this is inert and reads as an empty list,
 * which is what the sidebar wants anyway.
 */
export function useSocialReviewQueue(enabled: boolean): SocialWeekPlanRow[] {
  const [plans, setPlans] = useState<SocialWeekPlanRow[]>([]);

  useEffect(() => {
    if (!enabled) {
      setPlans([]);
      return;
    }
    const unsubscribe = watchSocialWeekPlansForReview(
      getDb(),
      setPlans,
      // A badge is not worth an error banner. If the listen fails, show nothing.
      () => setPlans([]),
    );
    return unsubscribe;
  }, [enabled]);

  return plans;
}
