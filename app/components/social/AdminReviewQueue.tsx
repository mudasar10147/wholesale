"use client";

import type { SocialWeekPlanRow } from "@/lib/firestore/socialWeekPlans";
import { formatWeekRange } from "@/lib/social/weekKeys";
import { ButtonLink } from "@/app/components/ui/Button";

type AdminReviewQueueProps = {
  plans: SocialWeekPlanRow[];
};

/**
 * The admin's inbox. `submitted` weeks are theirs to act on; a `revising` week is one they
 * already approved that the manager has since reopened — they cannot approve it until it
 * comes back, but they need to know it is no longer the week they signed off.
 */
export function AdminReviewQueue({ plans }: AdminReviewQueueProps) {
  if (plans.length === 0) return null;

  return (
    <section
      aria-label="Weeks needing your attention"
      className="space-y-3 rounded-lg border border-blue-500/40 bg-blue-500/5 p-4"
    >
      <h2 className="text-sm font-semibold text-foreground">
        {plans.length === 1 ? "1 week needs you" : `${plans.length} weeks need you`}
      </h2>

      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {plans.map((plan) => {
          const submitted = plan.status === "submitted";
          return (
            <li
              key={plan.id}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-[12rem]">
                <p className="text-sm font-medium text-foreground">
                  {formatWeekRange(plan.week_key)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {submitted
                    ? "Sent for approval."
                    : "Approved, then reopened by the social manager. Waiting for them to send it back."}
                </p>
              </div>
              <ButtonLink
                href={`/social/plan/${plan.week_key}`}
                variant={submitted ? "primary" : "outline"}
              >
                {submitted ? "Review" : "Open"}
              </ButtonLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
