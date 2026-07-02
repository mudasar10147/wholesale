import type { CustomerEngagementTierSettings } from "./customerEngagementConfig.ts";
import { defaultCustomerEngagementTierSettings } from "./customerEngagementConfig.ts";

export type CustomerEngagementTier = "premium" | "silver" | "bronze" | "none";

export type CustomerEngagementSegment =
  | "premium"
  | "silver"
  | "bronze"
  | "needs_follow_up"
  | "no_orders_yet";

export type CustomerEngagementTab =
  | "all"
  | "premium"
  | "silver"
  | "bronze"
  | "needs_follow_up"
  | "no_orders_yet";

export const CUSTOMER_ENGAGEMENT_TABS: ReadonlyArray<{
  id: CustomerEngagementTab;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "premium", label: "Premium" },
  { id: "silver", label: "Silver" },
  { id: "bronze", label: "Bronze" },
  { id: "needs_follow_up", label: "Needs follow-up" },
  { id: "no_orders_yet", label: "No orders yet" },
];

export type CustomerEngagementInput = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  is_active: boolean;
};

export type InvoiceEngagementInput = {
  customer_id: string;
  orderDate: Date;
  effectiveTotal: number;
};

export type CustomerEngagementRow = {
  customerId: string;
  customerName: string;
  phone?: string;
  email?: string;
  ordersLast30Days: number;
  spendLast30Days: number;
  totalPostedOrders: number;
  lastOrderDate: Date | null;
  daysSinceLastOrder: number | null;
  tier: CustomerEngagementTier;
  needsFollowUp: boolean;
  displaySegment: CustomerEngagementSegment;
  totalPurchased: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfRollingWindow(now: Date, rollingWindowDays: number): Date {
  return new Date(now.getTime() - rollingWindowDays * MS_PER_DAY);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function isPremiumTier(
  ordersLast30Days: number,
  spendLast30Days: number,
  settings: CustomerEngagementTierSettings,
): boolean {
  return (
    ordersLast30Days >= settings.premiumMinOrders &&
    spendLast30Days > settings.premiumMinSpend
  );
}

function isSilverTier(
  ordersLast30Days: number,
  spendLast30Days: number,
  settings: CustomerEngagementTierSettings,
): boolean {
  return (
    ordersLast30Days >= settings.silverMinOrders &&
    spendLast30Days > settings.silverMinSpend &&
    spendLast30Days < settings.silverMaxSpend
  );
}

function isBronzeTier(
  ordersLast30Days: number,
  spendLast30Days: number,
  settings: CustomerEngagementTierSettings,
): boolean {
  return (
    ordersLast30Days === settings.bronzeOrders &&
    spendLast30Days < settings.bronzeMaxSpend
  );
}

function tierFromMetrics(
  ordersLast30Days: number,
  spendLast30Days: number,
  settings: CustomerEngagementTierSettings,
): CustomerEngagementTier {
  if (isPremiumTier(ordersLast30Days, spendLast30Days, settings)) return "premium";
  if (isSilverTier(ordersLast30Days, spendLast30Days, settings)) return "silver";
  if (isBronzeTier(ordersLast30Days, spendLast30Days, settings)) return "bronze";
  return "none";
}

function segmentFromMetrics(
  ordersLast30Days: number,
  spendLast30Days: number,
  totalPostedOrders: number,
  settings: CustomerEngagementTierSettings,
): CustomerEngagementSegment {
  if (totalPostedOrders === 0) return "no_orders_yet";

  if (isPremiumTier(ordersLast30Days, spendLast30Days, settings)) return "premium";
  if (isSilverTier(ordersLast30Days, spendLast30Days, settings)) return "silver";
  if (isBronzeTier(ordersLast30Days, spendLast30Days, settings)) return "bronze";
  return "needs_follow_up";
}

export function computeCustomerEngagement(
  customers: CustomerEngagementInput[],
  invoices: InvoiceEngagementInput[],
  options?: { now?: Date; settings?: CustomerEngagementTierSettings },
): CustomerEngagementRow[] {
  const now = options?.now ?? new Date();
  const settings = options?.settings ?? defaultCustomerEngagementTierSettings();
  const windowStart = startOfRollingWindow(now, settings.rollingWindowDays);

  const byCustomer = new Map<
    string,
    {
      ordersLast30Days: number;
      spendLast30Days: number;
      totalPostedOrders: number;
      lastOrderDate: Date | null;
      totalPurchased: number;
    }
  >();

  for (const inv of invoices) {
    const customerId = inv.customer_id?.trim();
    if (!customerId) continue;

    const bucket = byCustomer.get(customerId) ?? {
      ordersLast30Days: 0,
      spendLast30Days: 0,
      totalPostedOrders: 0,
      lastOrderDate: null,
      totalPurchased: 0,
    };

    bucket.totalPostedOrders += 1;
    bucket.totalPurchased += inv.effectiveTotal;

    if (!bucket.lastOrderDate || inv.orderDate > bucket.lastOrderDate) {
      bucket.lastOrderDate = inv.orderDate;
    }

    if (inv.orderDate >= windowStart) {
      bucket.ordersLast30Days += 1;
      bucket.spendLast30Days += inv.effectiveTotal;
    }

    byCustomer.set(customerId, bucket);
  }

  const rows: CustomerEngagementRow[] = [];

  for (const customer of customers) {
    if (!customer.is_active) continue;

    const stats = byCustomer.get(customer.id) ?? {
      ordersLast30Days: 0,
      spendLast30Days: 0,
      totalPostedOrders: 0,
      lastOrderDate: null,
      totalPurchased: 0,
    };

    const daysSinceLastOrder = stats.lastOrderDate
      ? daysBetween(stats.lastOrderDate, now)
      : null;

    const displaySegment = segmentFromMetrics(
      stats.ordersLast30Days,
      stats.spendLast30Days,
      stats.totalPostedOrders,
      settings,
    );

    const needsFollowUp = displaySegment === "needs_follow_up";
    const tier = needsFollowUp
      ? "none"
      : tierFromMetrics(stats.ordersLast30Days, stats.spendLast30Days, settings);

    rows.push({
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      email: customer.email,
      ordersLast30Days: stats.ordersLast30Days,
      spendLast30Days: stats.spendLast30Days,
      totalPostedOrders: stats.totalPostedOrders,
      lastOrderDate: stats.lastOrderDate,
      daysSinceLastOrder,
      tier,
      needsFollowUp,
      displaySegment,
      totalPurchased: stats.totalPurchased,
    });
  }

  return rows;
}

export function matchesEngagementTab(
  row: CustomerEngagementRow,
  tab: CustomerEngagementTab,
): boolean {
  if (tab === "all") return true;
  return row.displaySegment === tab;
}

export function countByEngagementTab(
  rows: CustomerEngagementRow[],
): Record<CustomerEngagementTab, number> {
  const counts: Record<CustomerEngagementTab, number> = {
    all: rows.length,
    premium: 0,
    silver: 0,
    bronze: 0,
    needs_follow_up: 0,
    no_orders_yet: 0,
  };

  for (const row of rows) {
    counts[row.displaySegment] += 1;
  }

  return counts;
}

export function sortEngagementRows(
  rows: CustomerEngagementRow[],
  tab: CustomerEngagementTab,
): CustomerEngagementRow[] {
  const sorted = [...rows];
  if (tab === "needs_follow_up") {
    sorted.sort((a, b) => (b.daysSinceLastOrder ?? 0) - (a.daysSinceLastOrder ?? 0));
    return sorted;
  }
  sorted.sort((a, b) => a.customerName.localeCompare(b.customerName, undefined, { sensitivity: "base" }));
  return sorted;
}

export const ENGAGEMENT_SEGMENT_LABELS: Record<CustomerEngagementSegment, string> = {
  premium: "Premium",
  silver: "Silver",
  bronze: "Bronze",
  needs_follow_up: "Needs follow-up",
  no_orders_yet: "No orders yet",
};

export function describeEngagementRules(settings: CustomerEngagementTierSettings): string {
  return `Premium: ${settings.premiumMinOrders}+ orders and over ${settings.premiumMinSpend.toLocaleString()} PKR in ${settings.rollingWindowDays} days. Silver: ${settings.silverMinOrders}+ orders and ${settings.silverMinSpend.toLocaleString()}–${settings.silverMaxSpend.toLocaleString()} PKR. Bronze: ${settings.bronzeOrders} order under ${settings.bronzeMaxSpend.toLocaleString()} PKR.`;
}
