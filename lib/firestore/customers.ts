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
import { assertValidCustomerInput, normalizeCustomerInput } from "@/lib/validation/contracts";

export type CustomerInput = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
};

export async function createCustomer(db: Firestore, input: CustomerInput): Promise<void> {
  const next = normalizeCustomerInput(input);
  assertValidCustomerInput(next);

  await addDoc(collection(db, COLLECTIONS.customers), {
    ...next,
    is_active: true,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
}

export async function updateCustomer(
  db: Firestore,
  customerId: string,
  input: CustomerInput,
): Promise<void> {
  const next = normalizeCustomerInput(input);
  assertValidCustomerInput(next);

  await updateDoc(doc(db, COLLECTIONS.customers, customerId), {
    ...next,
    updated_at: serverTimestamp(),
  });
}

export async function archiveCustomer(db: Firestore, customerId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.customers, customerId), {
    is_active: false,
    archived_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
}

/** Count customers that are not archived (`is_active !== false`). */
export async function loadActiveCustomerCount(db: Firestore): Promise<number> {
  const snap = await getDocs(collection(db, COLLECTIONS.customers));
  let count = 0;
  snap.forEach((docSnap) => {
    const data = docSnap.data() as { is_active?: boolean };
    if (data.is_active !== false) count += 1;
  });
  return count;
}
