/**
 * Deadlines for Firestore calls that have none of their own.
 *
 * Not every Firestore call is bounded. Two kinds are, and one is not:
 *
 *  - `tx.get` / transaction commit go out as one-shot XHR POSTs
 *    (BatchGetDocuments / Commit) carrying a 15s deadline, and `TransactionRunner`
 *    retries a bounded number of times. These cannot hang forever.
 *  - `getDocs()` in the full SDK does NOT make a one-shot request. It registers a
 *    temporary `QueryListener` on the Listen (WebChannel) stream with
 *    `waitForSyncWhenOnline: true` and resolves a `Deferred` when a snapshot
 *    arrives. Nothing rejects that `Deferred` on a timer. So while the client
 *    believes it is online but its stream is actually dead, `getDocs` never
 *    settles — the caller waits forever.
 *  - Auth token fetches (`getIdToken`, and the token fetch the SDK does before
 *    every RPC) likewise have no deadline of their own.
 *
 * That is the difference between "posting is slow" and "posting is stuck at
 * Posting… and never comes back", and it is why a page reload cures it: a reload
 * builds a new stream. A thrown error is always better than an infinite spinner,
 * so the calls in the second and third categories get an explicit deadline here.
 */

export class FirestoreDeadlineError extends Error {
  readonly operation: string;
  readonly waitedMs: number;

  constructor(operation: string, waitedMs: number) {
    super(
      `Firestore did not respond to ${operation} within ${Math.round(waitedMs / 1000)}s. ` +
        "The realtime connection is most likely stalled rather than slow — reload the page and try again.",
    );
    this.name = "FirestoreDeadlineError";
    this.operation = operation;
    this.waitedMs = waitedMs;
  }
}

export function isFirestoreDeadlineError(e: unknown): e is FirestoreDeadlineError {
  return e instanceof FirestoreDeadlineError;
}

/**
 * Rejects with {@link FirestoreDeadlineError} if `work` has not settled in time.
 *
 * The underlying call is not cancellable — it keeps waiting on a stream we have
 * given up on, and is simply abandoned. `Promise.race` attaches a handler to it,
 * so a later rejection cannot surface as an unhandled rejection.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  operation: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new FirestoreDeadlineError(operation, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
