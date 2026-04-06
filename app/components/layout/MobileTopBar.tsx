"use client";

import Link from "next/link";

type MobileTopBarProps = {
  menuOpen: boolean;
  onMenuClick: () => void;
  menuContentId: string;
};

export function MobileTopBar({ menuOpen, onMenuClick, menuContentId }: MobileTopBarProps) {
  return (
    <header
      className="sticky top-0 z-[60] flex items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 shadow-[var(--shadow-xs)] backdrop-blur-sm md:hidden"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <Link
        href="/"
        className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Wholesale home"
      >
        <span className="block truncate text-base font-semibold tracking-tight text-foreground">
          Wholesale
        </span>
      </Link>
      <button
        type="button"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground shadow-xs transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={menuOpen}
        aria-controls={menuContentId}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        onClick={onMenuClick}
      >
        {menuOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden className="text-foreground">
            <path
              fill="currentColor"
              d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden className="text-foreground">
            <path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
          </svg>
        )}
      </button>
    </header>
  );
}
