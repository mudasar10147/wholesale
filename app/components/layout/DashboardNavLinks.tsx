"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { useSocialReviewQueue } from "@/app/components/social/useSocialReviewQueue";
import { isNavActive, isNavVisibleForUser, navItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type DashboardNavLinksProps = {
  /** Called after a link is activated (e.g. close mobile drawer). */
  onNavigate?: () => void;
};

export function DashboardNavLinks({ onNavigate }: DashboardNavLinksProps) {
  const pathname = usePathname();
  const { isAdmin, isClerk, isSocial } = useAuth();
  const visibleItems = navItems.filter((item) =>
    isNavVisibleForUser(item, { isAdmin, isClerk, isSocial }),
  );

  // The only count in the sidebar: weeks a social manager is waiting on the admin for.
  // Inert for everyone else.
  const socialReviewCount = useSocialReviewQueue(isAdmin).length;

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary">
      {visibleItems.map((item) => {
        const active = isNavActive(pathname, item.href);
        const count = item.href === "/social" ? socialReviewCount : 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center justify-between gap-2 rounded-r-lg border-l-2 border-transparent py-2.5 pl-3 pr-3 text-[0.8125rem] font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              active
                ? "border-primary bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/85 hover:bg-surface-hover hover:text-sidebar-foreground",
            )}
          >
            <span>{item.label}</span>
            {count > 0 ? (
              <span
                className="min-w-[1.25rem] rounded-full bg-primary px-1.5 py-0.5 text-center text-[0.6875rem] font-semibold leading-none text-primary-foreground"
                aria-label={`${count} week${count === 1 ? "" : "s"} waiting for you`}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
