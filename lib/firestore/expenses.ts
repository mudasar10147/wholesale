import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";

const EXPENSE_EDIT_WINDOW_DAYS = 2;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Expenses at most two calendar days old (today and the prior two days) may be edited. */
export function isExpenseEditable(date: Timestamp | undefined, now = new Date()): boolean {
  if (!date?.toDate) return false;
  const expenseDay = startOfLocalDay(date.toDate());
  const cutoff = startOfLocalDay(now);
  cutoff.setDate(cutoff.getDate() - EXPENSE_EDIT_WINDOW_DAYS);
  return expenseDay >= cutoff;
}

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

export async function updateExpense(
  db: Firestore,
  expenseId: string,
  params: { title: string; amount: number },
): Promise<void> {
  const title = params.title.trim();
  if (!title) {
    throw new Error("Title is required.");
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  await updateDoc(doc(db, COLLECTIONS.expenses, expenseId), {
    title,
    amount: params.amount,
  });
}
