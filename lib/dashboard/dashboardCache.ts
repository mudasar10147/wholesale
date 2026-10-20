/**
 * Session cache for the dashboard's document set.
 *
 * The dashboard costs ~3,021 reads per fetch even after the P1 dedup, and the
 * measured usage pattern is several visits per day plus period-preset clicks —
 * each of which previously paid full price for data that had barely changed.
 * Holding the raw documents for a short window makes repeat visits, back-
 * navigation and preset switching free.
 *
 * Deliberately in-memory rather than sessionStorage: `DashboardRaw` is full of
 * Firestore `Timestamp` objects, and JSON round-tripping would strip `toMillis()`
 * off every one of them. An in-memory cache survives client-side navigation
 * (the common case) and is discarded on a hard reload, which is the safe way to
 * fail.
 */
import type { Firestore } from "firebase/firestore";
import {
  fetchDashboardRaw,
  type DashboardFetchOptions,
  type DashboardRaw,
} from "@/lib/dashboard/dashboardData";

/** How long a fetched document set is reused before the next visit refetches. */
export const DASHBOARD_CACHE_TTL_MS = 5 * 60_000;

type CacheEntry = {
  raw: DashboardRaw;
  fetchedAt: Date;
  /**
   * Whether this document set includes the cash ledger. A clerk's fetch skips it,
   * and that cash-less set must never be handed to an admin asking for cash —
   * their dashboard would quietly read zero.
   */
  includeCash: boolean;
};

let entry: CacheEntry | null = null;
/** De-duplicates concurrent callers so a double mount fetches once, not twice. */
let inFlight: Promise<CacheEntry> | null = null;
/** What the in-flight fetch is collecting, for the same reason `CacheEntry` carries it. */
let inFlightIncludesCash = false;

export type DashboardFetch = {
  raw: DashboardRaw;
  fetchedAt: Date;
  /** True when served from cache — no Firestore reads were charged. */
  fromCache: boolean;
};

function isFresh(e: CacheEntry, now: number, ttlMs: number): boolean {
  return now - e.fetchedAt.getTime() < ttlMs;
}

/** A cash-less set satisfies a cash-less caller, and nothing else. */
function satisfies(e: { includeCash: boolean }, wantCash: boolean): boolean {
  return e.includeCash || !wantCash;
}

/**
 * Returns the dashboard documents, fetching only when there is nothing fresh
 * cached. Pass `force` to bypass the cache (what the Refresh control does).
 */
export async function getDashboardRaw(
  db: Firestore,
  opts: {
    force?: boolean;
    now?: number;
    ttlMs?: number;
    /** Admin-only; see {@link DashboardFetchOptions.includeCash}. Defaults to true. */
    includeCash?: boolean;
    /** Test seam — defaults to the real Firestore fetch. */
    fetcher?: (db: Firestore, options?: DashboardFetchOptions) => Promise<DashboardRaw>;
  } = {},
): Promise<DashboardFetch> {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? DASHBOARD_CACHE_TTL_MS;
  const includeCash = opts.includeCash ?? true;
  const fetcher = opts.fetcher ?? fetchDashboardRaw;

  if (!opts.force && entry && isFresh(entry, now, ttlMs) && satisfies(entry, includeCash)) {
    return { raw: entry.raw, fetchedAt: entry.fetchedAt, fromCache: true };
  }

  // A forced refresh must not be satisfied by a fetch that started earlier.
  if (!opts.force && inFlight && satisfies({ includeCash: inFlightIncludesCash }, includeCash)) {
    const shared = await inFlight;
    return { raw: shared.raw, fetchedAt: shared.fetchedAt, fromCache: true };
  }

  const pending = fetcher(db, { includeCash }).then((raw) => {
    const next: CacheEntry = { raw, fetchedAt: new Date(now), includeCash };
    entry = next;
    return next;
  });
  inFlight = pending;
  inFlightIncludesCash = includeCash;

  try {
    const fresh = await pending;
    return { raw: fresh.raw, fetchedAt: fresh.fetchedAt, fromCache: false };
  } finally {
    if (inFlight === pending) inFlight = null;
  }
}

/**
 * Drops the cached documents so the next read refetches. Call after a write that
 * changes a dashboard figure (posting an invoice, recording an expense or cash
 * entry) if you want the change reflected before the TTL lapses.
 */
export function invalidateDashboardCache(): void {
  entry = null;
}

/** Test seam — clears cached data and any in-flight fetch. */
export function __resetDashboardCache(): void {
  entry = null;
  inFlight = null;
}
