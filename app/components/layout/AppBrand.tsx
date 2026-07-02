import Image from "next/image";
import Link from "next/link";

const focusRing =
  "outline-none transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

/** App logo — links to dashboard home. */
export function AppBrand() {
  return (
    <Link href="/" className={`inline-block ${focusRing}`}>
      <Image
        src="/wholesale_logo.png"
        alt="Wholesale"
        width={804}
        height={200}
        className="h-10 max-h-10 w-auto object-contain"
        style={{ width: "auto" }}
        priority
      />
    </Link>
  );
}
