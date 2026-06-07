import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getAuthClient, getDb } from "@/lib/firebase";
import type { CustomerInput } from "@/lib/firestore/customers";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CustomerDoc } from "@/lib/types/firestore";
import { assertValidCustomerInput, normalizeCustomerInput } from "@/lib/validation/contracts";

const BATCH_SIZE = 450;

export type MergeCustomersInput = {
  keepCustomerId: string;
  mergeCustomerId: string;
  finalProfile: CustomerInput;
};

export type MergeCustomersCounts = {
  invoices: number;
  invoice_items: number;
  invoice_item_cogs: number;
  invoice_returns: number;
  invoice_return_items: number;
  sales: number;
};

export type MergeCustomersResult = {
  keep_customer_id: string;
  merged_customer_id: string;
  merged_customer_name: string;
  updated: MergeCustomersCounts;
};

async function assertCurrentUserIsAdmin(): Promise<string> {
  const user = getAuthClient().currentUser;
  if (!user) {
    throw new Error("Please sign in again.");
  }
  const token = await user.getIdTokenResult();
  const isAdmin = token.claims.admin === true || token.claims.admin === "true";
  if (!isAdmin) {
    throw new Error("Only admins can merge customers.");
  }
  return user.uid;
}

async function queryDocsByCustomerId(db: Firestore, collectionId: string, customerId: string) {
  const snap = await getDocs(
    query(collection(db, collectionId), where("customer_id", "==", customerId)),
  );
  return snap.docs;
}

async function batchSetCustomerId(
  db: Firestore,
  docs: QueryDocumentSnapshot[],
  keepCustomerId: string,
  touchUpdatedAt: boolean,
): Promise<number> {
  if (docs.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const docSnap of chunk) {
      const patch: Record<string, unknown> = { customer_id: keepCustomerId };
      if (touchUpdatedAt) {
        patch.updated_at = serverTimestamp();
      }
      batch.update(docSnap.ref, patch);
      updated += 1;
    }
    await batch.commit();
  }
  return updated;
}

function buildFinalProfilePatch(profile: CustomerInput): Record<string, unknown> {
  const normalized = normalizeCustomerInput(profile);
  assertValidCustomerInput(normalized);
  const patch: Record<string, unknown> = {
    name: normalized.name,
    is_active: true,
    archived_at: deleteField(),
    updated_at: serverTimestamp(),
  };
  if (normalized.phone) patch.phone = normalized.phone;
  else patch.phone = deleteField();
  if (normalized.email) patch.email = normalized.email;
  else patch.email = deleteField();
  if (normalized.address) patch.address = normalized.address;
  else patch.address = deleteField();
  return patch;
}

/**
 * Merge duplicate customer B into survivor A using the signed-in admin's Firestore access.
 */
export async function mergeCustomers(input: MergeCustomersInput): Promise<MergeCustomersResult> {
  const keepId = input.keepCustomerId.trim();
  const mergeId = input.mergeCustomerId.trim();
  if (!keepId || !mergeId) {
    throw new Error("Both customer IDs are required.");
  }
  if (keepId === mergeId) {
    throw new Error("Choose two different customers to merge.");
  }

  const mergedByUid = await assertCurrentUserIsAdmin();
  const db = getDb();
  const keepRef = doc(db, COLLECTIONS.customers, keepId);
  const mergeRef = doc(db, COLLECTIONS.customers, mergeId);

  const [keepSnap, mergeSnap] = await Promise.all([getDoc(keepRef), getDoc(mergeRef)]);
  if (!keepSnap.exists()) {
    throw new Error("Customer to keep was not found.");
  }
  if (!mergeSnap.exists()) {
    throw new Error("Customer to merge away was not found.");
  }

  const mergeData = mergeSnap.data() as CustomerDoc;
  const normalizedProfile = normalizeCustomerInput(input.finalProfile);

  const [
    invoiceDocs,
    invoiceItemDocs,
    invoiceItemCogsDocs,
    returnDocs,
    returnItemDocs,
    saleDocs,
  ] = await Promise.all([
    queryDocsByCustomerId(db, COLLECTIONS.invoices, mergeId),
    queryDocsByCustomerId(db, COLLECTIONS.invoiceItems, mergeId),
    queryDocsByCustomerId(db, COLLECTIONS.invoiceItemCogs, mergeId),
    queryDocsByCustomerId(db, COLLECTIONS.invoiceReturns, mergeId),
    queryDocsByCustomerId(db, COLLECTIONS.invoiceReturnItems, mergeId),
    queryDocsByCustomerId(db, COLLECTIONS.sales, mergeId),
  ]);

  const updated: MergeCustomersCounts = {
    invoices: await batchSetCustomerId(db, invoiceDocs, keepId, true),
    invoice_items: await batchSetCustomerId(db, invoiceItemDocs, keepId, true),
    invoice_item_cogs: await batchSetCustomerId(db, invoiceItemCogsDocs, keepId, false),
    invoice_returns: await batchSetCustomerId(db, returnDocs, keepId, true),
    invoice_return_items: await batchSetCustomerId(db, returnItemDocs, keepId, true),
    sales: await batchSetCustomerId(db, saleDocs, keepId, false),
  };

  await updateDoc(keepRef, buildFinalProfilePatch(input.finalProfile));

  await addDoc(collection(db, COLLECTIONS.customerMerges), {
    keep_customer_id: keepId,
    merged_customer_id: mergeId,
    merged_customer_name: mergeData.name ?? "",
    merged_by_uid: mergedByUid,
    final_profile: normalizedProfile,
    updated_counts: updated,
    created_at: serverTimestamp(),
  });

  await deleteDoc(mergeRef);

  return {
    keep_customer_id: keepId,
    merged_customer_id: mergeId,
    merged_customer_name: mergeData.name ?? "",
    updated,
  };
}
