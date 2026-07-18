"use client";

import { isNewArrival } from "@/lib/products/newArrival";
import { useNewArrivalSettings } from "@/lib/firestore/newArrivalSettings";
import { cn } from "@/lib/utils";

/**
 * The one "New" tag shown wherever a product is listed. Renders nothing unless the product
 * was created inside the new-arrival window, so it can be dropped in unconditionally next to
 * a product name.
 *
 * Pure by design: the window is passed in, not read here. A list renders many of these, so
 * the parent reads the window once (via {@link useNewArrivalSettings}) and threads it down
 * rather than opening a Firestore listener per row. For a one-off, use
 * {@link ConnectedNewArrivalBadge}.
 */
export function NewArrivalBadge({
  createdAt,
  thresholdDays,
  className,
}: {
  /** Firestore Timestamp, Date, or epoch ms — whatever the surface has on hand. */
  createdAt: unknown;
  thresholdDays: number;
  className?: string;
}) {
  if (!isNewArrival(createdAt, thresholdDays)) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400",
        className,
      )}
    >
      New
    </span>
  );
}

/** Self-contained badge that reads the window itself. Use for standalone, non-list surfaces. */
export function ConnectedNewArrivalBadge({
  createdAt,
  className,
}: {
  createdAt: unknown;
  className?: string;
}) {
  const { settings } = useNewArrivalSettings();
  return (
    <NewArrivalBadge
      createdAt={createdAt}
      thresholdDays={settings.thresholdDays}
      className={className}
    />
  );
}
