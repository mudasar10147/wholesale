/**
 * Run: npm run test:engagement
 */
import assert from "node:assert/strict";
import {
  computeCustomerEngagement,
  countByEngagementTab,
  matchesEngagementTab,
  type CustomerEngagementInput,
  type InvoiceEngagementInput,
} from "./customerEngagement.ts";
import { defaultCustomerEngagementTierSettings } from "./customerEngagementConfig.ts";

const tierSettings = defaultCustomerEngagementTierSettings();
const now = new Date("2026-06-15T12:00:00.000Z");

const customers: CustomerEngagementInput[] = [
  { id: "premium", name: "Premium Co", is_active: true, phone: "111" },
  { id: "silver", name: "Silver Co", is_active: true },
  { id: "bronze", name: "Bronze Co", is_active: true },
  { id: "follow_up_spend", name: "Big once Co", is_active: true },
  { id: "follow_up_freq", name: "Frequent small Co", is_active: true },
  { id: "idle", name: "Idle Co", is_active: true, phone: "222" },
  { id: "new", name: "New Co", is_active: true },
  { id: "archived", name: "Archived Co", is_active: false },
];

function daysAgo(n: number): Date {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
}

const invoices: InvoiceEngagementInput[] = [
  // Premium: 4+ orders AND > 50,000 PKR in last 30 days
  ...[5, 10, 15, 20].map((d) => ({
    customer_id: "premium",
    orderDate: daysAgo(d),
    effectiveTotal: 14_000,
  })),
  // Silver: 2+ orders AND 20,000–50,000 PKR in last 30 days
  { customer_id: "silver", orderDate: daysAgo(7), effectiveTotal: 12_000 },
  { customer_id: "silver", orderDate: daysAgo(21), effectiveTotal: 12_000 },
  // Bronze: 1 order AND < 20,000 PKR in last 30 days
  { customer_id: "bronze", orderDate: daysAgo(12), effectiveTotal: 300 },
  // Follow-up: high spend but only one order (missing frequency for premium)
  { customer_id: "follow_up_spend", orderDate: daysAgo(8), effectiveTotal: 55_000 },
  // Follow-up: 4 orders but low spend (missing spend for premium)
  ...[3, 8, 13, 18].map((d) => ({
    customer_id: "follow_up_freq",
    orderDate: daysAgo(d),
    effectiveTotal: 1_000,
  })),
  // Follow-up: inactive — last order 35 days ago
  { customer_id: "idle", orderDate: daysAgo(35), effectiveTotal: 2000 },
];

const rows = computeCustomerEngagement(customers, invoices, { now, settings: tierSettings });
const byId = new Map(rows.map((r) => [r.customerId, r]));

assert.equal(rows.length, 7, "archived customer excluded");

const premium = byId.get("premium");
assert.ok(premium);
assert.equal(premium.displaySegment, "premium");
assert.equal(premium.ordersLast30Days, 4);
assert.equal(premium.spendLast30Days, 56_000);
assert.equal(premium.needsFollowUp, false);

const silver = byId.get("silver");
assert.ok(silver);
assert.equal(silver.displaySegment, "silver");
assert.equal(silver.ordersLast30Days, 2);
assert.equal(silver.spendLast30Days, 24_000);

const bronze = byId.get("bronze");
assert.ok(bronze);
assert.equal(bronze.displaySegment, "bronze");
assert.equal(bronze.ordersLast30Days, 1);
assert.equal(bronze.spendLast30Days, 300);

const followUpSpend = byId.get("follow_up_spend");
assert.ok(followUpSpend);
assert.equal(followUpSpend.displaySegment, "needs_follow_up");
assert.equal(followUpSpend.needsFollowUp, true);

const followUpFreq = byId.get("follow_up_freq");
assert.ok(followUpFreq);
assert.equal(followUpFreq.displaySegment, "needs_follow_up");

const idle = byId.get("idle");
assert.ok(idle);
assert.equal(idle.displaySegment, "needs_follow_up");
assert.equal(idle.ordersLast30Days, 0);
assert.equal(idle.daysSinceLastOrder, 35);

const newCustomer = byId.get("new");
assert.ok(newCustomer);
assert.equal(newCustomer.displaySegment, "no_orders_yet");

assert.ok(!byId.has("archived"));

// 1 small order within rolling window → bronze
const edge30 = computeCustomerEngagement(
  [{ id: "edge30", name: "Edge30", is_active: true }],
  [{ customer_id: "edge30", orderDate: daysAgo(30), effectiveTotal: 100 }],
  { now, settings: tierSettings },
);
assert.equal(edge30[0]?.displaySegment, "bronze");

// 1 order above bronze spend band → follow-up
const edgeHighSingle = computeCustomerEngagement(
  [{ id: "edgeHigh", name: "EdgeHigh", is_active: true }],
  [{ customer_id: "edgeHigh", orderDate: daysAgo(10), effectiveTotal: 25_000 }],
  { now, settings: tierSettings },
);
assert.equal(edgeHighSingle[0]?.displaySegment, "needs_follow_up");

const counts = countByEngagementTab(rows);
assert.equal(counts.premium, 1);
assert.equal(counts.silver, 1);
assert.equal(counts.bronze, 1);
assert.equal(counts.needs_follow_up, 3);
assert.equal(counts.no_orders_yet, 1);
assert.equal(counts.all, 7);

assert.equal(matchesEngagementTab(idle!, "needs_follow_up"), true);
assert.equal(matchesEngagementTab(idle!, "premium"), false);

console.log("customerEngagement.test.ts: all assertions passed");
