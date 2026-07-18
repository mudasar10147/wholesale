import { DEFAULT_NEW_ARRIVAL_THRESHOLD_DAYS } from "@/lib/types/firestore";

/**
 * The one definition of "new arrival" for the whole app.
 *
 * A product is a new arrival when it was newly *created* — a brand-new SKU — within the
 * configured window. Restocking an existing SKU does NOT make it new again: this only ever
 * looks at `created_at`, never at stock receipts.
 *
 * Deliberately Firestore-free so it can run on the server, in the browser, and in tests.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type NewArrivalSettings = {
  /** A product stays "new" for this many days after it was created. */
  thresholdDays: number;
};

export function defaultNewArrivalSettings(): NewArrivalSettings {
  return { thresholdDays: DEFAULT_NEW_ARRIVAL_THRESHOLD_DAYS };
}

export const MIN_NEW_ARRIVAL_THRESHOLD_DAYS = 1;
export const MAX_NEW_ARRIVAL_THRESHOLD_DAYS = 365;

export function validateNewArrivalSettings(settings: NewArrivalSettings): void {
  const days = settings.thresholdDays;
  if (
    !Number.isInteger(days) ||
    days < MIN_NEW_ARRIVAL_THRESHOLD_DAYS ||
    days > MAX_NEW_ARRIVAL_THRESHOLD_DAYS
  ) {
    throw new Error(
      `New arrival window must be a whole number between ${MIN_NEW_ARRIVAL_THRESHOLD_DAYS} and ${MAX_NEW_ARRIVAL_THRESHOLD_DAYS} days.`,
    );
  }
}

/** Coerce whatever a caller has (Firestore Timestamp, Date, epoch ms) into a Date. */
export function toCreatedDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  // Firestore Timestamp (client or admin SDK) — duck-typed to avoid importing either SDK here.
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  return null;
}

/** Whole days a product has existed, or null when its creation date is unknown. */
export function productAgeDays(createdAt: unknown, now: Date = new Date()): number | null {
  const created = toCreatedDate(createdAt);
  if (!created) return null;
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / MS_PER_DAY));
}

/**
 * True when a product is still a new arrival. Products with no creation date are never new
 * (they predate the field — treating them as new would flood every list).
 */
export function isNewArrival(
  createdAt: unknown,
  thresholdDays: number,
  now: Date = new Date(),
): boolean {
  const created = toCreatedDate(createdAt);
  if (!created) return false;
  const cutoff = now.getTime() - thresholdDays * MS_PER_DAY;
  return created.getTime() >= cutoff;
}
