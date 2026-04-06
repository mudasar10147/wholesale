import {
  doc,
  increment,
  runTransaction,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";

/**
 * Increase stock atomically (stock in).
 */
export async function stockIn(
  db: Firestore,
  productId: string,
  quantity: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  const ref = doc(db, COLLECTIONS.products, productId);
  await updateDoc(ref, { stock_quantity: increment(quantity) });
}

/**
 * Decrease stock atomically (stock out). Fails if stock would go negative.
 */
export async function stockOut(
  db: Firestore,
  productId: string,
  quantity: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  const ref = doc(db, COLLECTIONS.products, productId);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new Error("Product not found.");
    }
    const data = snap.data();
    if (!data) {
      throw new Error("Product not found.");
    }
    const current =
      typeof data.stock_quantity === "number" ? data.stock_quantity : 0;
    if (current < quantity) {
      throw new Error("Not enough stock.");
    }
    transaction.update(ref, { stock_quantity: increment(-quantity) });
  });
}
