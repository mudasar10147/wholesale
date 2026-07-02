"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { CustomerCrudPanel } from "@/app/components/customers/CustomerCrudPanel";
import { CustomerEngagementPanel } from "@/app/components/customers/CustomerEngagementPanel";
import { CustomerLedgerTable } from "@/app/components/customers/CustomerLedgerTable";
import { CustomerPurchaseReturnPanel } from "@/app/components/customers/CustomerPurchaseReturnPanel";
import { cn } from "@/lib/utils";

export type CustomerPageTab = "engagement" | "returns" | "management" | "ledger";

const TAB_META: Record<
  CustomerPageTab,
  { label: string; title: string; description: string }
> = {
  engagement: {
    label: "Engagement",
    title: "Customer engagement",
    description:
      "Tier rules are configured in Settings. Premium and Silver require both order frequency and spend in the rolling window.",
  },
  returns: {
    label: "Returns",
    title: "Create return from purchase history",
    description:
      "Select a customer and search by product name or invoice number to find what they bought. Create a return against the correct invoice without opening each sale one by one.",
  },
  management: {
    label: "Management",
    title: "Customer management",
    description:
      "Update customer details, archive old records, or merge duplicates into one customer (moves all linked invoices and deletes the duplicate).",
  },
  ledger: {
    label: "Ledger",
    title: "Customer ledger",
    description:
      "Revenue analytics by customer: purchased, paid/unpaid, discounts, delivery charges, and net revenue contribution.",
  },
};

const DEFAULT_TAB_ORDER: CustomerPageTab[] = [
  "engagement",
  "returns",
  "management",
  "ledger",
];

const PANEL_ID = "customer-section-panel";

export function CustomerPageTabs() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<CustomerPageTab>("engagement");

  const visibleTabs = useMemo(() => {
    if (authLoading) return DEFAULT_TAB_ORDER.filter((t) => t !== "returns");
    if (isAdmin) return DEFAULT_TAB_ORDER;
    return DEFAULT_TAB_ORDER.filter((t) => t !== "returns");
  }, [authLoading, isAdmin]);

  useEffect(() => {
    if (!authLoading && activeTab === "returns" && !isAdmin) {
      setActiveTab("engagement");
    }
  }, [authLoading, isAdmin, activeTab]);

  const selectTab = useCallback((tab: CustomerPageTab) => {
    const scrollY = window.scrollY;
    setActiveTab(tab);
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollY);
    });
  }, []);

  const meta = TAB_META[activeTab];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div
        className="flex gap-1 bg-surface-muted/80 p-1.5"
        role="tablist"
        aria-label="Customer sections"
      >
        {visibleTabs.map((tab) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`customer-tab-${tab}`}
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectTab(tab)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center truncate px-3 py-3 text-sm transition-all duration-150 sm:py-3.5",
                selected
                  ? "rounded-lg bg-surface font-semibold text-foreground shadow-sm"
                  : "rounded-lg font-medium text-muted-foreground hover:bg-surface/50 hover:text-foreground",
              )}
            >
              {TAB_META[tab].label}
            </button>
          );
        })}
      </div>

      <div className="bg-surface px-4 py-4 sm:px-6 sm:py-5">
        <div className="mb-5">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{meta.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{meta.description}</p>
        </div>

        <div id={PANEL_ID} role="tabpanel" aria-labelledby={`customer-tab-${activeTab}`}>
          <div className={activeTab === "engagement" ? undefined : "hidden"}>
            <CustomerEngagementPanel />
          </div>
          {isAdmin ? (
            <div className={activeTab === "returns" ? undefined : "hidden"}>
              <CustomerPurchaseReturnPanel />
            </div>
          ) : null}
          <div className={activeTab === "management" ? undefined : "hidden"}>
            <CustomerCrudPanel />
          </div>
          <div className={activeTab === "ledger" ? undefined : "hidden"}>
            <CustomerLedgerTable />
          </div>
        </div>
      </div>
    </div>
  );
}
