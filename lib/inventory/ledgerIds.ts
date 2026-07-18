/**
 * Deterministic Firestore document ID for outbox ledger rows.
 * One row per (type, source_document_type, source_document_id) — safe under concurrent fulfill.
 */
export function ledgerTransactionDocId(
  type: string,
  sourceDocumentType: string,
  sourceDocumentId: string,
): string {
  const slug = `${type}__${sourceDocumentType}__${sourceDocumentId}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 220);
  return `ldg_${slug}`;
}

/** Max attempts for ledger fulfillment (matches stock operation retry count). */
export const LEDGER_FULFILL_MAX_ATTEMPTS = 3;

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal backoff between ledger retries: 0ms, 100ms, 300ms */
export function ledgerRetryDelayMs(attempt: number): number {
  if (attempt <= 0) return 0;
  if (attempt === 1) return 100;
  return 300;
}
