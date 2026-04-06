"use client";

import { startTransition, useEffect, useId, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MobileNavDrawer } from "@/app/components/layout/MobileNavDrawer";
import { MobileTopBar } from "@/app/components/layout/MobileTopBar";
import { Sidebar } from "@/app/components/layout/Sidebar";

type DashboardShellProps = {
  children: ReactNode;
};

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuPanelId = useId();

  useEffect(() => {
    startTransition(() => {
      setMobileNavOpen(false);
    });
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-transparent">
      <Sidebar />
      <div className="relative flex min-h-screen min-w-0 flex-1 flex-col shadow-[var(--shadow-sidebar)]">
        <MobileTopBar
          menuOpen={mobileNavOpen}
          onMenuClick={() => setMobileNavOpen((open) => !open)}
          menuContentId={menuPanelId}
        />
        <main className="flex-1 px-4 pb-8 pt-4 sm:px-8 sm:py-10 lg:px-10">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        panelId={menuPanelId}
      />
    </div>
  );
}
