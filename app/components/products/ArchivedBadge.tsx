import { isProductArchived } from "@/lib/products/archive";
import { cn } from "@/lib/utils";

/**
 * The "Archived" tag shown wherever a retired product still appears — the archived
 * tab, its profile page, and historical records that reference it.
 *
 * Like {@link NewArrivalBadge} it renders nothing when the product is active, so it
 * can be dropped in unconditionally next to a product name.
 */
export function ArchivedBadge({
  product,
  className,
}: {
  product: { is_active?: boolean };
  className?: string;
}) {
  if (!isProductArchived(product)) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      Archived
    </span>
  );
}
