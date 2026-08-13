/**
 * Run: npm run test:dashboard-cache
 *
 * Each dashboard fetch costs ~3,000 Firestore reads, so what matters here is
 * exactly how many times the fetcher is invoked. Every test counts calls.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_CACHE_TTL_MS,
  __resetDashboardCache,
  getDashboardRaw,
  invalidateDashboardCache,
} from "./dashboardCache.ts";
import type { DashboardRaw } from "./dashboardData.ts";

const DB = {} as import("firebase/firestore").Firestore;

function stubRaw(marker: number): DashboardRaw {
  return {
    products: [],
    invoices: [],
    sales: [],
    expenses: [],
    stockLots: [],
    cashEntries: [],
    customers: [],
    invoiceReturns: [],
    inventoryDiscards: [],
    cashSettings: { opening_balance: marker } as unknown as DashboardRaw["cashSettings"],
  };
}

/** Returns a fetcher plus a live call counter. */
function countingFetcher(delayMs = 0) {
  const state = { calls: 0 };
  const fetcher = async () => {
    state.calls += 1;
    const marker = state.calls;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return stubRaw(marker);
  };
  return { fetcher, state };
}

test("first call fetches, second is served from cache", async () => {
  __resetDashboardCache();
  const { fetcher, state } = countingFetcher();

  const a = await getDashboardRaw(DB, { fetcher, now: 1_000 });
  const b = await getDashboardRaw(DB, { fetcher, now: 1_000 });

  assert.equal(state.calls, 1, "second visit must not refetch");
  assert.equal(a.fromCache, false);
  assert.equal(b.fromCache, true);
  assert.deepEqual(b.raw, a.raw);
});

test("cache expires after the TTL", async () => {
  __resetDashboardCache();
  const { fetcher, state } = countingFetcher();

  await getDashboardRaw(DB, { fetcher, now: 0 });
  await getDashboardRaw(DB, { fetcher, now: DASHBOARD_CACHE_TTL_MS - 1 });
  assert.equal(state.calls, 1, "still inside the window");

  const stale = await getDashboardRaw(DB, { fetcher, now: DASHBOARD_CACHE_TTL_MS + 1 });
  assert.equal(state.calls, 2, "past the window it refetches");
  assert.equal(stale.fromCache, false);
});

test("force bypasses a fresh cache — this is what Refresh does", async () => {
  __resetDashboardCache();
  const { fetcher, state } = countingFetcher();

  await getDashboardRaw(DB, { fetcher, now: 1_000 });
  const forced = await getDashboardRaw(DB, { fetcher, now: 1_000, force: true });

  assert.equal(state.calls, 2);
  assert.equal(forced.fromCache, false);
});

test("concurrent callers share one fetch", async () => {
  __resetDashboardCache();
  const { fetcher, state } = countingFetcher(20);

  const [a, b, c] = await Promise.all([
    getDashboardRaw(DB, { fetcher, now: 1_000 }),
    getDashboardRaw(DB, { fetcher, now: 1_000 }),
    getDashboardRaw(DB, { fetcher, now: 1_000 }),
  ]);

  assert.equal(state.calls, 1, "a double mount must not double the read cost");
  assert.deepEqual(a.raw, b.raw);
  assert.deepEqual(b.raw, c.raw);
});

test("invalidate forces the next call to refetch", async () => {
  __resetDashboardCache();
  const { fetcher, state } = countingFetcher();

  await getDashboardRaw(DB, { fetcher, now: 1_000 });
  invalidateDashboardCache();
  await getDashboardRaw(DB, { fetcher, now: 1_000 });

  assert.equal(state.calls, 2);
});

test("a failed fetch is not cached", async () => {
  __resetDashboardCache();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error("offline");
  };

  await assert.rejects(() => getDashboardRaw(DB, { fetcher: failing, now: 1_000 }));
  await assert.rejects(() => getDashboardRaw(DB, { fetcher: failing, now: 1_000 }));

  assert.equal(calls, 2, "an error must not poison the cache or be served as data");
});
