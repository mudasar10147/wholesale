import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { getInvoiceAmountDue } from "@/lib/invoices/invoiceEffective";
import {
  appliedLines,
  describePaymentPlanProblem,
  paymentPlanProblem,
  planCustomerPayment,
  samePaymentSplit,
  type PaymentAllocationLine,
  type PaymentAllocationPlan,
} from "@/lib/invoices/customerPaymentAllocation";
import type { InvoiceDoc } from "@/lib/types/firestore";

/** Firestore caps a transaction at 500 writes; stay clear of it with room to spare. */
const MAX_INVOICES_PER_PAYMENT = 450;

/** Thrown when balances moved between the preview the admin confirmed and the write. */
export class PaymentSplitChangedError extends Error {
  constructor() {
    super(
      "This customer's balances changed while you were reviewing the payment. The split has been " +
        "updated — check it and confirm again. Nothing was recorded.",
    );
    this.name = "PaymentSplitChangedError";
  }
}

export type RecordCustomerPaymentInput = {
  customerId: string;
  amount: number;
  /**
   * The split the admin confirmed. When given, the write is refused unless the fresh
   * balances produce exactly this split, so nobody records a payment they did not see.
   */
  expectedSplit?: ReadonlyArray<Pick<PaymentAllocationLine, "invoiceId" | "applied">>;
};

/**
 * Records one payment received from a customer, settling their posted invoices oldest
 * first (see `planCustomerPayment`). All or nothing: the invoices are re-read and updated
 * in a single transaction, and a payment larger than what they owe writes nothing.
 *
 * Each invoice changes exactly as a single-invoice payment would (`paid_amount`,
 * `payment_status`), so the customer ledger, Sales list, delivery list and cash in hand
 * all pick it up with no further bookkeeping.
 */
export async function recordCustomerPayment(
  db: Firestore,
  input: RecordCustomerPaymentInput,
): Promise<PaymentAllocationPlan> {
  const customerId = input.customerId.trim();
  if (!customerId) {
    throw new Error("Choose a customer.");
  }

  // Transactions cannot run queries, so find the candidates first and re-read each one
  // inside the transaction. Anything paid in between shows up there with nothing due.
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.invoices), where("customer_id", "==", customerId)),
  );
  const candidateRefs = snap.docs
    .filter((docSnap) => {
      const invoice = docSnap.data() as InvoiceDoc;
      return invoice.status === "posted" && getInvoiceAmountDue(invoice) > 0.01;
    })
    .map((docSnap) => doc(db, COLLECTIONS.invoices, docSnap.id));

  return runTransaction(db, async (tx) => {
    const fresh = await Promise.all(candidateRefs.map((ref) => tx.get(ref)));
    const invoices = fresh
      .filter((docSnap) => docSnap.exists())
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as InvoiceDoc) }))
      .filter((invoice) => invoice.customer_id === customerId);

    const plan = planCustomerPayment(invoices, input.amount);
    const problem = paymentPlanProblem(plan);
    if (problem) {
      throw new Error(describePaymentPlanProblem(plan, problem));
    }

    const lines = appliedLines(plan);
    if (input.expectedSplit && !samePaymentSplit(lines, input.expectedSplit)) {
      throw new PaymentSplitChangedError();
    }
    if (lines.length > MAX_INVOICES_PER_PAYMENT) {
      throw new Error(
        `This payment would settle ${lines.length} invoices at once, more than can be saved together ` +
          `(${MAX_INVOICES_PER_PAYMENT}). Record it in two smaller payments.`,
      );
    }

    for (const line of lines) {
      tx.update(doc(db, COLLECTIONS.invoices, line.invoiceId), {
        paid_amount: line.paidAfter,
        payment_status: line.paymentStatusAfter,
        updated_at: serverTimestamp(),
      });
    }
    return plan;
  });
}
