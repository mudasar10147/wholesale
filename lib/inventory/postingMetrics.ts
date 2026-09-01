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

/** Logs one phase of a post, with the ms elapsed since the previous phase. */
export type PostingPhaseLog = (phase: string, docCount?: number) => void;

/**
 * Per-phase stopwatch for one post. The single-line summary above reports only a
 * total, which cannot answer "which phase is slow?" — and the answer matters,
 * because each `tx.get` is its own network round trip, so a phase's cost is
 * really its document count times latency.
 *
 * Counts and IDs ONLY (§17): a phase name, a doc count, elapsed ms. Never throws.
 */
export function startPostingPhaseLog(invoiceId: string, attempt?: number): PostingPhaseLog {
  let last = nowMs();
  const label = attempt === undefined ? "" : ` a${attempt}`;
  return (phase, docCount) => {
    const now = nowMs();
    const ms = Math.round(now - last);
    last = now;
    try {
      const count = docCount === undefined ? "" : ` x${docCount}`;
      console.info(`[post] ${invoiceId}${label} ${phase}${count} ${ms}ms`);
    } catch {
      /* never let instrumentation break a post */
    }
  };
}
