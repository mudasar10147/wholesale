import { addDoc, collection, serverTimestamp, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";

/**
 * Create an expense document. `date` is set to server time.
 */
export async function addExpense(
  db: Firestore,
  params: { title: string; amount: number },
): Promise<void> {
  const title = params.title.trim();
  if (!title) {
    throw new Error("Title is required.");
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  await addDoc(collection(db, COLLECTIONS.expenses), {
    title,
    amount: params.amount,
    date: serverTimestamp(),
  });
}
