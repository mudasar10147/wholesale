import {
  addDoc,
  collection,
  getDocs,
  query,
  Timestamp,
  where,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { PartnerLoanDoc, PartnerLoanEntryType } from "@/lib/types/firestore";

export type AddPartnerLoanEntryInput = {
  partnerName: string;
  entryType: PartnerLoanEntryType;
  amount: number;
  /** Defaults to current client time if omitted. */
  date?: Date;
  note?: string;
};

export async function addPartnerLoanEntry(
  db: Firestore,
  input: AddPartnerLoanEntryInput,
): Promise<void> {
  const partnerName = input.partnerName.trim();
  if (partnerName.length < 2) {
    throw new Error("Partner name must be at least 2 characters.");
  }
  if (!["loan_in", "repayment"].includes(input.entryType)) {
    throw new Error("Entry type must be loan_in or repayment.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const note = input.note?.trim();
  if (note && note.length > 500) {
    throw new Error("Note must be 500 characters or less.");
  }

  const when = input.date ?? new Date();
  await addDoc(collection(db, COLLECTIONS.partnerLoans), {
    partner_name: partnerName,
    entry_type: input.entryType,
    amount: input.amount,
    date: Timestamp.fromDate(when),
    ...(note ? { note } : {}),
    created_at: serverTimestamp(),
  } satisfies Omit<PartnerLoanDoc, "created_at"> & { created_at: unknown });
}

export type PartnerLoanRow = PartnerLoanDoc & { id: string };

export async function fetchPartnerLoansInRange(
  db: Firestore,
  start: Date,
  end: Date,
): Promise<PartnerLoanRow[]> {
  const q = query(
    collection(db, COLLECTIONS.partnerLoans),
    where("date", ">=", Timestamp.fromDate(start)),
    where("date", "<=", Timestamp.fromDate(end)),
  );
  const snap = await getDocs(q);
  const out: PartnerLoanRow[] = [];
  snap.forEach((d) => out.push({ id: d.id, ...(d.data() as PartnerLoanDoc) }));
  return out;
}

export async function fetchAllPartnerLoans(db: Firestore): Promise<PartnerLoanRow[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.partnerLoans));
  const out: PartnerLoanRow[] = [];
  snap.forEach((d) => out.push({ id: d.id, ...(d.data() as PartnerLoanDoc) }));
  return out;
}
