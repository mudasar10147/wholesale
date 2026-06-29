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
import { assertValidPartyInput, normalizePartyInput } from "@/lib/validation/contracts";

export type PartyInput = {
  name: string;
  phone?: string;
  address?: string;
  contact_person?: string;
  city?: string;
  notes?: string;
};

/** Creates a party and returns its new document id. */
export async function createParty(db: Firestore, input: PartyInput): Promise<string> {
  const next = normalizePartyInput(input);
  assertValidPartyInput(next);

  const ref = await addDoc(collection(db, COLLECTIONS.parties), {
    ...next,
    is_active: true,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
}

export async function updateParty(
  db: Firestore,
  partyId: string,
  input: PartyInput,
): Promise<void> {
  const next = normalizePartyInput(input);
  assertValidPartyInput(next);

  await updateDoc(doc(db, COLLECTIONS.parties, partyId), {
    ...next,
    updated_at: serverTimestamp(),
  });
}

export async function archiveParty(db: Firestore, partyId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.parties, partyId), {
    is_active: false,
    archived_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
}

/** Count parties that are not archived (`is_active !== false`). */
export async function loadActivePartyCount(db: Firestore): Promise<number> {
  const snap = await getDocs(collection(db, COLLECTIONS.parties));
  let count = 0;
  snap.forEach((docSnap) => {
    const data = docSnap.data() as { is_active?: boolean };
    if (data.is_active !== false) count += 1;
  });
  return count;
}
