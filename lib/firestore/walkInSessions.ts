import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { getAuthClient } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProductDoc, WalkInLineDoc, WalkInSessionDoc } from "@/lib/types/firestore";

/** Local midnight for the given calendar day (used as business `sale_date`). */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export type WalkInLineInput = {
  productId: string;
  quantity: number;
  unitSalePrice: number;
};

function walkInLinesRef(db: Firestore, sessionId: string) {
  return collection(db, COLLECTIONS.walkInSessions, sessionId, "lines");
}

/**
 * Create a pending walk-in session with line items (single batch).
 */
export async function createWalkInSession(
  db: Firestore,
  params: { saleDate: Date; lines: WalkInLineInput[]; uid: string | null },
): Promise<string> {
  if (params.lines.length === 0) {
    throw new Error("Add at least one line item.");
  }
  for (const line of params.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Each line needs a positive whole-number quantity.");
    }
    if (!Number.isFinite(line.unitSalePrice) || line.unitSalePrice < 0) {
      throw new Error("Each line needs a valid unit sale price.");
    }
  }

  const sessionRef = doc(collection(db, COLLECTIONS.walkInSessions));
  const now = serverTimestamp();
  const saleTs = Timestamp.fromDate(startOfLocalDay(params.saleDate));

  // Commit the session alone first. Line creates use rules that `get()` the parent; batched
  // session+lines in one commit fails permission checks because `get()` does not see uncommitted writes.
  await setDoc(sessionRef, {
    status: "pending" as const,
    sale_date: saleTs,
    line_count: params.lines.length,
    created_at: now,
    updated_at: now,
    ...(params.uid ? { created_by_uid: params.uid } : {}),
  });

  try {
    const batch = writeBatch(db);
    const linesCol = walkInLinesRef(db, sessionRef.id);
    for (const line of params.lines) {
      const lineRef = doc(linesCol);
      batch.set(lineRef, {
        product_id: line.productId,
        quantity: line.quantity,
        unit_sale_price: line.unitSalePrice,
        created_at: now,
      });
    }
    await batch.commit();
  } catch (err) {
    await deleteDoc(sessionRef);
    throw err;
  }

  return sessionRef.id;
}

/**
 * Replace all lines and update sale date for a pending session.
 */
export async function replaceWalkInSessionContent(
  db: Firestore,
  sessionId: string,
  params: { saleDate: Date; lines: WalkInLineInput[] },
): Promise<void> {
  if (params.lines.length === 0) {
    throw new Error("Add at least one line item.");
  }
  const sessionRef = doc(db, COLLECTIONS.walkInSessions, sessionId);
  const snap = await getDoc(sessionRef);
  if (!snap.exists()) {
    throw new Error("Session not found.");
  }
  const sess = snap.data() as WalkInSessionDoc;
  if (sess.status !== "pending") {
    throw new Error("Only pending sessions can be edited.");
  }

  for (const line of params.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Each line needs a positive whole-number quantity.");
    }
    if (!Number.isFinite(line.unitSalePrice) || line.unitSalePrice < 0) {
      throw new Error("Each line needs a valid unit sale price.");
    }
  }

  const existing = await getDocs(walkInLinesRef(db, sessionId));
  const batch = writeBatch(db);
  const now = serverTimestamp();
  const saleTs = Timestamp.fromDate(startOfLocalDay(params.saleDate));

  existing.forEach((d) => batch.delete(d.ref));
  const linesCol = walkInLinesRef(db, sessionId);
  for (const line of params.lines) {
    const lineRef = doc(linesCol);
    batch.set(lineRef, {
      product_id: line.productId,
      quantity: line.quantity,
      unit_sale_price: line.unitSalePrice,
      created_at: now,
    });
  }
  batch.update(sessionRef, {
    sale_date: saleTs,
    line_count: params.lines.length,
    updated_at: now,
  });
  await batch.commit();
}

/**
 * Admin: write `sales` rows + decrement stock; mark session approved.
 */
export async function approveWalkInSession(db: Firestore, sessionId: string): Promise<void> {
  const auth = getAuthClient();
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("You must be signed in to approve.");
  }

  const sessionRef = doc(db, COLLECTIONS.walkInSessions, sessionId);
  const linesSnap = await getDocs(walkInLinesRef(db, sessionId));
  if (linesSnap.empty) {
    throw new Error("Session has no line items.");
  }

  const lineDocs = linesSnap.docs;
  const lineData = lineDocs.map((d) => d.data() as WalkInLineDoc);

  await runTransaction(db, async (transaction) => {
    const sessSnap = await transaction.get(sessionRef);
    if (!sessSnap.exists()) {
      throw new Error("Session not found.");
    }
    const sess = sessSnap.data() as WalkInSessionDoc;
    if (sess.status !== "pending") {
      throw new Error("Session is not pending.");
    }
    const saleDateTs = sess.sale_date;

    for (let i = 0; i < lineDocs.length; i++) {
      const line = lineData[i]!;
      const lineRef = lineDocs[i]!.ref;
      const lineSnap = await transaction.get(lineRef);
      if (!lineSnap.exists()) {
        throw new Error("Line item missing.");
      }

      const productRef = doc(db, COLLECTIONS.products, line.product_id);
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists()) {
        throw new Error(`Product not found: ${line.product_id}`);
      }
      const product = productSnap.data() as ProductDoc;
      const stock =
        typeof product.stock_quantity === "number" ? product.stock_quantity : 0;
      if (stock < line.quantity) {
        throw new Error(`Not enough stock for product (${line.product_id}).`);
      }

      const unitPrice = line.unit_sale_price;
      const totalAmount = unitPrice * line.quantity;
      const saleRef = doc(collection(db, COLLECTIONS.sales));

      transaction.set(saleRef, {
        walk_in_session_id: sessionId,
        product_id: line.product_id,
        quantity: line.quantity,
        sale_price: unitPrice,
        total_amount: totalAmount,
        date: saleDateTs,
      });

      transaction.update(productRef, {
        stock_quantity: increment(-line.quantity),
      });
    }

    transaction.update(sessionRef, {
      status: "approved",
      approved_at: serverTimestamp(),
      approved_by_uid: uid,
      updated_at: serverTimestamp(),
    });
  });
}

/**
 * Admin: reject pending session (no stock / sales changes).
 */
export async function rejectWalkInSession(
  db: Firestore,
  sessionId: string,
  note?: string,
): Promise<void> {
  const sessionRef = doc(db, COLLECTIONS.walkInSessions, sessionId);
  const snap = await getDoc(sessionRef);
  if (!snap.exists()) {
    throw new Error("Session not found.");
  }
  const sess = snap.data() as WalkInSessionDoc;
  if (sess.status !== "pending") {
    throw new Error("Session is not pending.");
  }

  await updateDoc(sessionRef, {
    status: "rejected",
    updated_at: serverTimestamp(),
    ...(note && note.trim().length > 0
      ? { rejection_note: note.trim() }
      : { rejection_note: deleteField() }),
  });
}

/** Delete pending session and its lines. */
export async function deletePendingWalkInSession(db: Firestore, sessionId: string): Promise<void> {
  const sessionRef = doc(db, COLLECTIONS.walkInSessions, sessionId);
  const snap = await getDoc(sessionRef);
  if (!snap.exists()) {
    return;
  }
  const sess = snap.data() as WalkInSessionDoc;
  if (sess.status !== "pending") {
    throw new Error("Only pending sessions can be deleted.");
  }
  const lines = await getDocs(walkInLinesRef(db, sessionId));
  const batch = writeBatch(db);
  lines.forEach((d) => batch.delete(d.ref));
  batch.delete(sessionRef);
  await batch.commit();
}

export type WalkInSessionRow = {
  id: string;
  data: WalkInSessionDoc;
};

/**
 * List pending sessions, newest business date first.
 */
export async function fetchPendingWalkInSessions(db: Firestore): Promise<WalkInSessionRow[]> {
  const q = query(collection(db, COLLECTIONS.walkInSessions), where("status", "==", "pending"));
  const snap = await getDocs(q);
  const out: WalkInSessionRow[] = [];
  snap.forEach((d) => out.push({ id: d.id, data: d.data() as WalkInSessionDoc }));
  out.sort((a, b) => {
    const ta = a.data.sale_date?.toMillis?.() ?? 0;
    const tb = b.data.sale_date?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return out;
}

export async function fetchWalkInLines(
  db: Firestore,
  sessionId: string,
): Promise<Array<{ id: string; data: WalkInLineDoc }>> {
  const snap = await getDocs(walkInLinesRef(db, sessionId));
  const out: Array<{ id: string; data: WalkInLineDoc }> = [];
  snap.forEach((d) => out.push({ id: d.id, data: d.data() as WalkInLineDoc }));
  return out;
}
