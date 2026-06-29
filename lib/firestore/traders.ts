import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { assertValidTraderInput, normalizeTraderInput } from "@/lib/validation/contracts";

export type TraderInput = {
  name: string;
  phone?: string;
  address?: string;
  contact_person?: string;
  city?: string;
  notes?: string;
};

/** Creates a trader and returns its new document id. */
export async function createTrader(db: Firestore, input: TraderInput): Promise<string> {
  const next = normalizeTraderInput(input);
  assertValidTraderInput(next);

  const ref = await addDoc(collection(db, COLLECTIONS.traders), {
    ...next,
    is_active: true,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
}

export async function updateTrader(
  db: Firestore,
  traderId: string,
  input: TraderInput,
): Promise<void> {
  const next = normalizeTraderInput(input);
  assertValidTraderInput(next);

  await updateDoc(doc(db, COLLECTIONS.traders, traderId), {
    ...next,
    updated_at: serverTimestamp(),
  });
}

export async function archiveTrader(db: Firestore, traderId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.traders, traderId), {
    is_active: false,
    archived_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
}

/** Count traders that are not archived (`is_active !== false`). */
export async function loadActiveTraderCount(db: Firestore): Promise<number> {
  const snap = await getDocs(collection(db, COLLECTIONS.traders));
  let count = 0;
  snap.forEach((docSnap) => {
    const data = docSnap.data() as { is_active?: boolean };
    if (data.is_active !== false) count += 1;
  });
  return count;
}
