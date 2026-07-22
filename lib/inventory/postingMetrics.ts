/**
 * Invoice-posting performance instrumentation (§17). Emits ONE structured event
 * per post so Phase 2 can optimise against data, and so the M2 deploy gate can be
 * measured: retry_count is the direct observable for anchor contention, and a
 * sustained rise after M2 is the earliest warning that the concurrency model is
 * wrong.
 *
 * Counts and IDs ONLY. Never log cost prices, sale prices, customer identifiers,
 * or monetary totals (§17).
 */

export type PostingOutcome = "posted" | "failed";

export type PostingMetrics = {
  invoice_id: string;
  uid?: string;
  outcome: PostingOutcome;
  /** Wall-clock for the whole postInvoice call. */
  total_ms: number;
  /** Transaction attempts (1 = no retry). */
  txn_attempts: number;
  /** Retries = attempts − 1. The key contention signal. */
  retry_count: number;
  product_count: number;
  /** Active lots read (tx.get) inside the transaction — op-cap headroom. */
  active_lots_read: number;
  /** The preflight op-cap estimate (§17 S3). */
  op_estimate: number;
};

/** Monotonic-ish clock; falls back to Date.now where performance is unavailable. */
export function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Emit one structured, PII-free posting event. Never throws. */
export function emitPostingMetrics(m: PostingMetrics): void {
  try {
    // Single-line JSON so log pipelines can parse it; rounded ms to avoid noise.
    console.info("[postingMetrics]", JSON.stringify({ ...m, total_ms: Math.round(m.total_ms) }));
  } catch {
    /* never let instrumentation break a post */
  }
}
