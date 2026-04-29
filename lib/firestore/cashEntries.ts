import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CashEntryDoc, CashEntryType } from "@/lib/types/firestore";

export type CashEntryRow = CashEntryDoc & { id: string };

export type AddCashEntryInput = {
  entryType: CashEntryType;
  amount: number;
  date?: Date;
  note?: string;
};

export type UpdateCashEntryInput = {
  entryType: CashEntryType;
  amount: number;
  date: Date;
  note?: string;
};

function validateEntryType(entryType: string): asserts entryType is CashEntryType {
  if (entryType !== "add" && entryType !== "remove") {
    throw new Error("Entry type must be add or remove.");
  }
}

function validateAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
}

function normalizeNote(note?: string): string | undefined {
  const trimmed = note?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 500) {
    throw new Error("Note must be 500 characters or less.");
  }
  return trimmed;
}

function toTimestamp(date: Date | undefined): Timestamp {
  const next = date ?? new Date();
  if (Number.isNaN(next.getTime())) {
    throw new Error("Date must be valid.");
  }
  return Timestamp.fromDate(next);
}

export async function addCashEntry(db: Firestore, input: AddCashEntryInput): Promise<void> {
  validateEntryType(input.entryType);
  validateAmount(input.amount);
  const note = normalizeNote(input.note);

  await addDoc(collection(db, COLLECTIONS.cashEntries), {
    entry_type: input.entryType,
    amount: input.amount,
    date: toTimestamp(input.date),
    ...(note ? { note } : {}),
    created_at: serverTimestamp(),
  } satisfies Omit<CashEntryDoc, "created_at"> & { created_at: unknown });
}

export async function updateCashEntry(
  db: Firestore,
  entryId: string,
  input: UpdateCashEntryInput,
): Promise<void> {
  const id = entryId.trim();
  if (!id) {
    throw new Error("Entry id is required.");
  }
  validateEntryType(input.entryType);
  validateAmount(input.amount);
  const note = normalizeNote(input.note);

  await updateDoc(doc(db, COLLECTIONS.cashEntries, id), {
    entry_type: input.entryType,
    amount: input.amount,
    date: toTimestamp(input.date),
    ...(note ? { note } : { note: null }),
  } as Partial<CashEntryDoc> & { note?: string | null });
}

export async function deleteCashEntry(db: Firestore, entryId: string): Promise<void> {
  const id = entryId.trim();
  if (!id) {
    throw new Error("Entry id is required.");
  }
  await deleteDoc(doc(db, COLLECTIONS.cashEntries, id));
}

export async function fetchAllCashEntries(db: Firestore): Promise<CashEntryRow[]> {
  const q = query(collection(db, COLLECTIONS.cashEntries), orderBy("date", "desc"));
  const snap = await getDocs(q);
  const rows: CashEntryRow[] = [];
  snap.forEach((d) => {
    rows.push({ id: d.id, ...(d.data() as CashEntryDoc) });
  });
  return rows;
}
