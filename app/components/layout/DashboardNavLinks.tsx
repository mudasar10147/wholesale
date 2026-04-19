"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { isNavActive, isNavVisibleForUser, navItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type DashboardNavLinksProps = {
  /** Called after a link is activated (e.g. close mobile drawer). */
  onNavigate?: () => void;
};

export function DashboardNavLinks({ onNavigate }: DashboardNavLinksProps) {
  const pathname = usePathname();
  const { isAdmin, isClerk } = useAuth();
  const visibleItems = navItems.filter((item) =>
    isNavVisibleForUser(item, { isAdmin, isClerk }),
  );

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary">
      {visibleItems.map((item) => {
        const active = isNavActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "rounded-r-lg border-l-2 border-transparent py-2.5 pl-3 pr-3 text-[0.8125rem] font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              active
                ? "border-primary bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/85 hover:bg-surface-hover hover:text-sidebar-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
