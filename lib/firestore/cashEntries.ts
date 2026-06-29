import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
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
import type { CashEntryDoc, CashEntryType, LoanEntryKind } from "@/lib/types/firestore";

export type CashEntryRow = CashEntryDoc & { id: string };

export type AddCashEntryInput = {
  entryType: CashEntryType;
  amount: number;
  date?: Date;
  note?: string;
  partyId?: string;
  partyName?: string;
  /** When set, marks this as a loan movement and derives the cash direction. */
  loanKind?: LoanEntryKind;
};

export type UpdateCashEntryInput = {
  entryType: CashEntryType;
  amount: number;
  date: Date;
  note?: string;
  partyId?: string;
  partyName?: string;
  /** When set, marks this as a loan movement and derives the cash direction. */
  loanKind?: LoanEntryKind;
};

/** `borrowed`/`collected` bring cash in; `repaid`/`lent` take cash out. */
export function entryTypeForLoanKind(kind: LoanEntryKind): CashEntryType {
  return kind === "borrowed" || kind === "collected" ? "add" : "remove";
}

function validateEntryType(entryType: string): asserts entryType is CashEntryType {
  if (entryType !== "add" && entryType !== "remove") {
    throw new Error("Entry type must be add or remove.");
  }
}

function validateLoanKind(kind: string): asserts kind is LoanEntryKind {
  if (kind !== "borrowed" && kind !== "repaid" && kind !== "lent" && kind !== "collected") {
    throw new Error("Invalid loan kind.");
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

/** Resolve the party link. Returns undefined fields when no party is selected. */
function normalizeParty(partyId?: string, partyName?: string): {
  party_id?: string;
  party_name?: string;
} {
  const id = partyId?.trim();
  if (!id) return {};
  const name = partyName?.trim();
  if (name && name.length > 120) {
    throw new Error("Party name must be 120 characters or fewer.");
  }
  return { party_id: id, ...(name ? { party_name: name } : {}) };
}

function toTimestamp(date: Date | undefined): Timestamp {
  const next = date ?? new Date();
  if (Number.isNaN(next.getTime())) {
    throw new Error("Date must be valid.");
  }
  return Timestamp.fromDate(next);
}

export async function addCashEntry(db: Firestore, input: AddCashEntryInput): Promise<void> {
  validateAmount(input.amount);
  const note = normalizeNote(input.note);
  const party = normalizeParty(input.partyId, input.partyName);

  let entryType = input.entryType;
  let loanFields: { loan_kind?: LoanEntryKind } = {};
  if (input.loanKind) {
    validateLoanKind(input.loanKind);
    if (!party.party_id) {
      throw new Error("A loan entry must have a party.");
    }
    entryType = entryTypeForLoanKind(input.loanKind);
    loanFields = { loan_kind: input.loanKind };
  }
  validateEntryType(entryType);

  await addDoc(collection(db, COLLECTIONS.cashEntries), {
    entry_type: entryType,
    amount: input.amount,
    date: toTimestamp(input.date),
    ...(note ? { note } : {}),
    ...party,
    ...loanFields,
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
  validateAmount(input.amount);
  const note = normalizeNote(input.note);
  const party = normalizeParty(input.partyId, input.partyName);

  let entryType = input.entryType;
  let loanKindValue: LoanEntryKind | null = null;
  if (input.loanKind) {
    validateLoanKind(input.loanKind);
    if (!party.party_id) {
      throw new Error("A loan entry must have a party.");
    }
    entryType = entryTypeForLoanKind(input.loanKind);
    loanKindValue = input.loanKind;
  }
  validateEntryType(entryType);

  await updateDoc(doc(db, COLLECTIONS.cashEntries, id), {
    entry_type: entryType,
    amount: input.amount,
    date: toTimestamp(input.date),
    note: note ?? deleteField(),
    party_id: party.party_id ?? deleteField(),
    party_name: party.party_name ?? deleteField(),
    loan_kind: loanKindValue ?? deleteField(),
  });
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
