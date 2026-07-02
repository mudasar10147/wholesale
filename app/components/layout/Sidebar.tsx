"use client";

import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";
import { AppBrand } from "@/app/components/layout/AppBrand";
import { DashboardNavLinks } from "@/app/components/layout/DashboardNavLinks";
import { SidebarNewInvoiceButton } from "@/app/components/layout/SidebarNewInvoiceButton";
import { Button } from "@/app/components/ui/Button";

export function Sidebar() {
  const router = useRouter();
  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden h-screen w-[15rem] flex-col border-r border-sidebar-border bg-sidebar md:flex md:w-[17rem]"
      aria-label="Main navigation"
    >
      <div className="shrink-0 border-b border-sidebar-border px-5 py-4">
        <AppBrand />
      </div>

      <div className="shrink-0 px-3 pt-3">
        <SidebarNewInvoiceButton />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
        <DashboardNavLinks />
      </div>

      <div className="shrink-0 border-t border-sidebar-border px-5 py-4">
        <Button
          type="button"
          variant="outline"
          className="mb-3 w-full border-sidebar-border text-xs text-sidebar-foreground hover:bg-sidebar-hover"
          onClick={() => {
            void signOut(getAuthClient()).then(() => router.push("/login"));
          }}
        >
          Sign out
        </Button>
        <p className="text-xs leading-relaxed text-sidebar-muted">MVP · v0.1</p>
      </div>
    </aside>
  );
}
