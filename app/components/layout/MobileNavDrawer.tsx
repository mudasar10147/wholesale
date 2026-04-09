"use client";

import { useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";
import { AppBrand } from "@/app/components/layout/AppBrand";
import { DashboardNavLinks } from "@/app/components/layout/DashboardNavLinks";
import { Button } from "@/app/components/ui/Button";

type MobileNavDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Id for the sliding panel (aria-controls from menu button). */
  panelId: string;
};

export function MobileNavDrawer({ open, onClose, panelId }: MobileNavDrawerProps) {
  const router = useRouter();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px] transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        id={panelId}
        className="absolute left-0 top-0 flex h-full w-[min(18rem,85vw)] flex-col border-r border-sidebar-border bg-sidebar shadow-[var(--shadow-sidebar)] transition-transform duration-[var(--duration-normal)] ease-[var(--ease-out)]"
      >
        <div className="border-b border-sidebar-border px-5 py-6" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}>
          <p id={titleId} className="sr-only">
            Main navigation
          </p>
          <AppBrand />
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-muted">
            Menu
          </p>
          <DashboardNavLinks onNavigate={onClose} />
        </div>
        <div className="border-t border-sidebar-border px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="mb-3 w-full border-sidebar-border text-xs text-sidebar-foreground hover:bg-sidebar-hover"
            onClick={() => {
              onClose();
              void signOut(getAuthClient()).then(() => router.push("/login"));
            }}
          >
            Sign out
          </Button>
          <p className="text-xs leading-relaxed text-sidebar-muted">MVP · v0.1</p>
        </div>
      </div>
    </div>
  );
}
