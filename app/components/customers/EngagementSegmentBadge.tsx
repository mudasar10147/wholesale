import type { CustomerEngagementSegment } from "@/lib/customers/customerEngagement";
import { cn } from "@/lib/utils";

const SEGMENT_STYLES: Record<CustomerEngagementSegment, string> = {
  premium: "bg-success-muted text-success",
  silver: "bg-surface-hover text-foreground border border-border",
  bronze: "bg-accent-muted text-accent-foreground",
  needs_follow_up: "bg-destructive-muted text-destructive",
  no_orders_yet: "bg-surface-muted text-muted-foreground",
};

const SEGMENT_LABELS: Record<CustomerEngagementSegment, string> = {
  premium: "Premium",
  silver: "Silver",
  bronze: "Bronze",
  needs_follow_up: "Needs follow-up",
  no_orders_yet: "No orders yet",
};

type EngagementSegmentBadgeProps = {
  segment: CustomerEngagementSegment;
  className?: string;
};

export function EngagementSegmentBadge({ segment, className }: EngagementSegmentBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        SEGMENT_STYLES[segment],
        className,
      )}
    >
      {SEGMENT_LABELS[segment]}
    </span>
  );
}
