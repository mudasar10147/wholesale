/**
 * On-demand validation orchestration (§9.6). Wraps runValidation with the
 * controls a costly, operator-triggered scan needs: a Firestore concurrency lock
 * (one run at a time; a second request gets the in-progress run, never a parallel
 * scan) and cost-based rate limits. Admin-only + read-only identity are enforced
 * at the route; this module is the server-side mechanism.
 */

import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { runValidation, type RunMode, type ValidationRunRecord } from "@/lib/inventory/validationRun";

const LOCK_ID = "current";
const LOCK_TTL_MS = 30 * 60 * 1000; // §9.6 — a crashed run cannot block forever
const INCREMENTAL_MIN_GAP_MS = 5 * 60 * 1000; // 1 per 5 min
const INCREMENTAL_HOURLY_CAP = 12;
const FULL_REFUSE_IF_WITHIN_MS = 15 * 60 * 1000; // refuse full if one finished <15 min ago
const FULL_HOURLY_CAP = 1; // 1 full per hour

export type TriggerResult =
  | { status: "started"; record: ValidationRunRecord }
  | { status: "in_progress"; run_id: string | null }
  | { status: "rate_limited"; retry_after_seconds: number; message: string };

function rateLimited(retryMs: number, message: string): TriggerResult {
  return { status: "rate_limited", retry_after_seconds: Math.ceil(retryMs / 1000), message };
}

async function recentRuns(db: Firestore, limit = 30): Promise<ValidationRunRecord[]> {
  const snap = await db.collection(COLLECTIONS.inventoryValidationRuns).orderBy("as_of", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data() as ValidationRunRecord);
}

function checkRateLimit(mode: RunMode, runs: ValidationRunRecord[], nowMs: number): TriggerResult | null {
  if (mode === "incremental") {
    const last = runs.find((r) => r.mode === "incremental");
    if (last) {
      const gap = nowMs - last.as_of.toMillis();
      if (gap < INCREMENTAL_MIN_GAP_MS) return rateLimited(INCREMENTAL_MIN_GAP_MS - gap, "Incremental validation is limited to once every 5 minutes.");
    }
    const inHour = runs.filter((r) => r.mode === "incremental" && nowMs - r.as_of.toMillis() < 3_600_000).length;
    if (inHour >= INCREMENTAL_HOURLY_CAP) return rateLimited(3_600_000, "Hourly incremental validation limit reached.");
    return null;
  }
  // full
  const lastFull = runs.find((r) => r.mode === "full");
  if (lastFull) {
    const sinceFull = nowMs - lastFull.as_of.toMillis();
    if (sinceFull < FULL_REFUSE_IF_WITHIN_MS) return rateLimited(FULL_REFUSE_IF_WITHIN_MS - sinceFull, "A full validation ran less than 15 minutes ago.");
  }
  const fullInHour = runs.filter((r) => r.mode === "full" && nowMs - r.as_of.toMillis() < 3_600_000).length;
  if (fullInHour >= FULL_HOURLY_CAP) return rateLimited(3_600_000, "Full validation is limited to once per hour.");
  return null;
}

/**
 * Acquire the run lock. Returns { ok:true } if we hold it, else { ok:false,
 * run_id } pointing at the in-progress run (null if it hasn't recorded one yet).
 */
async function acquireLock(db: Firestore, mode: RunMode, uid: string, nowMs: number): Promise<{ ok: boolean; run_id: string | null }> {
  const lockRef = db.collection(COLLECTIONS.inventoryValidationLocks).doc(LOCK_ID);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    if (snap.exists) {
      const lock = snap.data() as { acquired_at: Timestamp; run_id?: string | null };
      if (nowMs - lock.acquired_at.toMillis() < LOCK_TTL_MS) {
        return { ok: false, run_id: lock.run_id ?? null };
      }
    }
    tx.set(lockRef, { acquired_at: Timestamp.fromMillis(nowMs), uid, mode, run_id: null });
    return { ok: true, run_id: null };
  });
}

async function releaseLock(db: Firestore): Promise<void> {
  await db.collection(COLLECTIONS.inventoryValidationLocks).doc(LOCK_ID).delete().catch(() => {});
}

export type TriggerOptions = { mode: RunMode; projectId: string; uid: string; now?: Date };

/**
 * Run validation on demand, honouring the rate limits and the single-run lock.
 * Never runs two scans at once; a colliding request returns the in-progress run.
 */
export async function triggerValidation(db: Firestore, opts: TriggerOptions): Promise<TriggerResult> {
  const nowMs = (opts.now ?? new Date()).getTime();

  const limited = checkRateLimit(opts.mode, await recentRuns(db), nowMs);
  if (limited) return limited;

  const lock = await acquireLock(db, opts.mode, opts.uid, nowMs);
  if (!lock.ok) return { status: "in_progress", run_id: lock.run_id };

  try {
    const { record } = await runValidation(db, { mode: opts.mode, projectId: opts.projectId, asOf: opts.now });
    await db.collection(COLLECTIONS.inventoryValidationLocks).doc(LOCK_ID).set({ run_id: record.run_id }, { merge: true });
    return { status: "started", record };
  } finally {
    await releaseLock(db);
  }
}
