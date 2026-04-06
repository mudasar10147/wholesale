import Link from "next/link";

const focusRing =
  "outline-none transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

/** App title block — uses theme tokens from globals.css only. */
export function AppBrand() {
  return (
    <Link href="/" className={`block ${focusRing}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
        Operations
      </span>
      <span className="mt-2 block border-l-2 border-primary pl-2 text-lg font-bold tracking-tight text-foreground">
        Wholesale
      </span>
    </Link>
  );
}
