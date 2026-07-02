"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  computeCustomerEngagement,
  countByEngagementTab,
  CUSTOMER_ENGAGEMENT_TABS,
  describeEngagementRules,
  matchesEngagementTab,
  sortEngagementRows,
  type CustomerEngagementRow,
  type CustomerEngagementTab,
} from "@/lib/customers/customerEngagement";
import { getInvoiceEffectiveTotal } from "@/lib/invoices/invoiceEffective";
import {
  tierDiscountPercent,
  useCustomerEngagementSettings,
} from "@/lib/firestore/customerEngagementSettings";
import type { CustomerDoc, InvoiceDoc } from "@/lib/types/firestore";
import { EngagementSegmentBadge } from "@/app/components/customers/EngagementSegmentBadge";
import { ButtonLink } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

type CustomerRow = CustomerDoc & { id: string };
type InvoiceRow = InvoiceDoc & { id: string };

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString();
}

export function CustomerEngagementPanel() {
  const { settings, loading: settingsLoading } = useCustomerEngagementSettings();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<CustomerEngagementTab>("all");

  useEffect(() => {
    const db = getDb();
    let customersReady = false;
    let invoicesReady = false;

    function maybeDone() {
      if (customersReady && invoicesReady) setLoading(false);
    }

    const unsubCustomers = onSnapshot(
      collection(db, COLLECTIONS.customers),
      (snap) => {
        customersReady = true;
        setError(null);
        const next: CustomerRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as CustomerDoc) }));
        setCustomers(next);
        maybeDone();
      },
      (err) => {
        customersReady = true;
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );

    const unsubInvoices = onSnapshot(
      collection(db, COLLECTIONS.invoices),
      (snap) => {
        invoicesReady = true;
        setError(null);
        const next: InvoiceRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InvoiceDoc) }));
        setInvoices(next);
        maybeDone();
      },
      (err) => {
        invoicesReady = true;
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );

    return () => {
      unsubCustomers();
      unsubInvoices();
    };
  }, []);

  const engagementRows = useMemo(() => {
    const invoiceInputs = invoices
      .filter((inv) => inv.status === "posted")
      .map((inv) => {
        const orderDate = inv.posted_at?.toDate() ?? inv.created_at?.toDate();
        if (!orderDate) return null;
        return {
          customer_id: inv.customer_id,
          orderDate,
          effectiveTotal: getInvoiceEffectiveTotal(inv),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return computeCustomerEngagement(
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        is_active: c.is_active !== false,
      })),
      invoiceInputs,
      { settings },
    );
  }, [customers, invoices, settings]);

  const tabCounts = useMemo(() => countByEngagementTab(engagementRows), [engagementRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tabbed = engagementRows.filter((row) => matchesEngagementTab(row, activeTab));
    const searched = q
      ? tabbed.filter((row) => {
          const hay = [row.customerName, row.phone ?? "", row.email ?? ""]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : tabbed;
    return sortEngagementRows(searched, activeTab);
  }, [engagementRows, activeTab, search]);

  const activeTabLabel =
    CUSTOMER_ENGAGEMENT_TABS.find((t) => t.id === activeTab)?.label ?? activeTab;

  if (loading || settingsLoading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading customer engagement…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{describeEngagementRules(settings)}</p>
        <ButtonLink href="/settings" variant="outline" size="sm">
          Edit tier settings
        </ButtonLink>
      </div>

      {activeTab === "needs_follow_up" ? (
        <InlineAlert variant="warning">
          These customers did not match Premium, Silver, or Bronze (order frequency and spend in the
          last {settings.rollingWindowDays} days), or they have stopped ordering. Reach out to
          understand why and how to win them back.
        </InlineAlert>
      ) : null}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Customer engagement">
        {CUSTOMER_ENGAGEMENT_TABS.map((tab) => {
          const count = tabCounts[tab.id];
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                selected
                  ? tab.id === "needs_follow_up"
                    ? "border-destructive bg-destructive-muted text-destructive"
                    : "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                  selected ? "bg-primary/15 text-primary" : "bg-surface-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="max-w-md">
        <Label htmlFor="engagement-search" className="text-sm text-foreground">
          Search customers
        </Label>
        <Input
          id="engagement-search"
          type="search"
          className="mt-1.5 h-10"
          placeholder="Name, phone, or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {search.trim() || activeTab !== "all"
            ? `Showing ${filteredRows.length} of ${tabCounts[activeTab]} in ${activeTabLabel}${search.trim() ? " (filtered)" : ""}`
            : `${engagementRows.length} active customer${engagementRows.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {filteredRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search.trim()
            ? `No customers in ${activeTabLabel.toLowerCase()} match “${search.trim()}”.`
            : `No customers in ${activeTabLabel.toLowerCase()}.`}
        </p>
      ) : (
        <EngagementTable
          rows={filteredRows}
          highlightFollowUp={activeTab === "needs_follow_up"}
          settings={settings}
          rollingWindowDays={settings.rollingWindowDays}
        />
      )}
    </div>
  );
}

function EngagementTable({
  rows,
  highlightFollowUp,
  settings,
  rollingWindowDays,
}: {
  rows: CustomerEngagementRow[];
  highlightFollowUp: boolean;
  settings: Parameters<typeof tierDiscountPercent>[1];
  rollingWindowDays: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-4 py-3 font-semibold text-foreground">Customer</th>
            <th className="px-4 py-3 font-semibold text-foreground">Segment</th>
            <th className="px-4 py-3 font-semibold text-foreground">Last order</th>
            <th className="px-4 py-3 font-semibold text-foreground text-right">Days idle</th>
            <th className="px-4 py-3 font-semibold text-foreground text-right">
              Orders ({rollingWindowDays}d)
            </th>
            <th className="px-4 py-3 font-semibold text-foreground text-right">
              Purchased ({rollingWindowDays}d)
            </th>
            <th className="px-4 py-3 font-semibold text-foreground text-right">Tier discount</th>
            <th className="px-4 py-3 font-semibold text-foreground text-right">Total purchased</th>
            <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const discount = tierDiscountPercent(row.displaySegment, settings);
            return (
            <tr
              key={row.customerId}
              className={cn(
                "border-b border-border last:border-b-0 align-top",
                i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                highlightFollowUp && row.needsFollowUp && "bg-destructive-muted/20",
              )}
            >
              <td className="px-4 py-3">
                <div className="font-medium text-foreground">{row.customerName}</div>
                {row.phone ? (
                  <div className="text-xs text-muted-foreground">{row.phone}</div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <EngagementSegmentBadge segment={row.displaySegment} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(row.lastOrderDate)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {row.daysSinceLastOrder !== null ? row.daysSinceLastOrder : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{row.ordersLast30Days}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(row.spendLast30Days)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {discount > 0 ? `${discount}%` : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{money(row.totalPurchased)}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {row.phone ? (
                    <ButtonLink href={`tel:${row.phone.replace(/\s/g, "")}`} variant="outline" size="sm">
                      Call
                    </ButtonLink>
                  ) : null}
                  <ButtonLink
                    href={`/sales/new?customerId=${encodeURIComponent(row.customerId)}`}
                    variant="outline"
                    size="sm"
                  >
                    New invoice
                  </ButtonLink>
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
