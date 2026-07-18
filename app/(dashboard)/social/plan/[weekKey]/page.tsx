import { redirect } from "next/navigation";
import { SocialOnly } from "@/app/components/auth/SocialOnly";
import { WeekPlanBuilder } from "@/app/components/social/WeekPlanBuilder";
import { parseWeekKey } from "@/lib/social/weekKeys";

type PageProps = { params: Promise<{ weekKey: string }> };

export default async function SocialWeekPlanPage({ params }: PageProps) {
  const { weekKey } = await params;

  // A hand-typed or stale URL must not reach the board, where weekDates() would throw.
  if (!parseWeekKey(weekKey)) {
    redirect("/social");
  }

  return (
    <SocialOnly>
      <WeekPlanBuilder weekKey={weekKey} />
    </SocialOnly>
  );
}
