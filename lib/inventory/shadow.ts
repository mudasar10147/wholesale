import { collection, doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { inventoryEngineConfig } from "@/lib/inventory/config";

export type ShadowDiffInput = {
  context: string;
  product_id?: string;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
};

/** Log shadow engine parity diffs when shadow mode is enabled. */
export async function logInventoryShadowDiff(
  db: Firestore,
  input: ShadowDiffInput,
): Promise<void> {
  if (!inventoryEngineConfig.shadowMode) return;

  const same = JSON.stringify(input.expected) === JSON.stringify(input.actual);
  if (same) return;

  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    console.warn("[inventory shadow diff]", input.context, input);
  }

  try {
    await setDoc(doc(collection(db, COLLECTIONS.inventoryShadowDiffs)), {
      context: input.context,
      product_id: input.product_id,
      expected: input.expected,
      actual: input.actual,
      created_at: serverTimestamp(),
    });
  } catch {
    // Shadow logging must never break inventory operations.
  }
}
