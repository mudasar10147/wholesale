"use client";

import { AppBrand } from "@/app/components/layout/AppBrand";
import { DashboardNavLinks } from "@/app/components/layout/DashboardNavLinks";

export function Sidebar() {
  return (
    <aside
      className="hidden w-[15rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex md:w-[17rem]"
      aria-label="Main navigation"
    >
      <div className="border-b border-sidebar-border px-5 py-7">
        <AppBrand />
      </div>

      <div className="flex flex-1 flex-col px-3 py-4">
        <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-muted">
          Menu
        </p>
        <DashboardNavLinks />
      </div>

      <div className="border-t border-sidebar-border px-5 py-4">
        <p className="text-xs leading-relaxed text-sidebar-muted">MVP · v0.1</p>
      </div>
    </aside>
  );
}
