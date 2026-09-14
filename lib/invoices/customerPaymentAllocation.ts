/**
 * Splitting one payment received from a customer across their posted invoices.
 *
 * The shop hands over a lump sum ("here is 5,000") rather than paying invoice by
 * invoice. The sum settles the oldest invoice first and carries whatever is left to
 * the next one, so a customer's longest-standing debt always clears first — the same
 * order the receivables ageing reads them in (by posting date).
 *
 * Nothing here writes. The plan is computed identically for the on-screen preview and
 * inside the Firestore transaction that records it, so what the admin confirms is what
 * lands. Money is split in whole cents, so the parts always add back to the amount.
 */
import type { InvoiceDoc, InvoicePaymentStatus } from "@/lib/types/firestore";
import {
  derivePaymentStatus,
  getInvoiceAmountDue,
  getInvoicePaidAmount,
  type InvoiceBalanceFields,
} from "@/lib/invoices/invoiceEffective";

/** Balances at or below this are treated as settled, matching the single-invoice payment. */
const SETTLED_EPSILON = 0.01;

export type PaymentAllocationInvoice = InvoiceBalanceFields &
  Pick<InvoiceDoc, "order_id" | "status" | "returns_post_status"> & {
    id: string;
    posted_at?: { toMillis(): number } | null;
    created_at?: { toMillis(): number } | null;
  };

export type PaymentAllocationLine = {
  invoiceId: string;
  orderId: string;
  paidBefore: number;
  dueBefore: number;
  /** Part of the payment this invoice receives. Zero when the payment ran out before it. */
  applied: number;
  paidAfter: number;
  dueAfter: number;
  paymentStatusAfter: InvoicePaymentStatus;
};

/** An invoice with a balance that cannot take a payment yet. */
export type HeldInvoice = {
  invoiceId: string;
  orderId: string;
  amountDue: number;
  reason: "returns_pending";
};

export type PaymentAllocationPlan = {
  /** The payment, rounded to cents. Zero when the entered amount is not a positive number. */
  amount: number;
  /** What the customer owes across the invoices that can take this payment. */
  totalDue: number;
  /** Every payable invoice in the order the payment reaches them, including ones it does not. */
  lines: PaymentAllocationLine[];
  /** Balances left out of the split, with the reason. */
  held: HeldInvoice[];
  /** Part of the payment no invoice can absorb. Anything above zero means nothing is recorded. */
  excess: number;
  /** What the customer still owes on these invoices once the payment is recorded. */
  dueAfter: number;
};

export type PaymentPlanProblem = "invalid_amount" | "nothing_due" | "exceeds_due";

function toCents(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fromCents(cents: number): number {
  return cents / 100;
}

function invoiceAgeKey(invoice: PaymentAllocationInvoice): number {
  const posted = invoice.posted_at?.toMillis?.();
  if (typeof posted === "number" && Number.isFinite(posted)) return posted;
  const created = invoice.created_at?.toMillis?.();
  return typeof created === "number" && Number.isFinite(created) ? created : 0;
}

/** Oldest first; the order id breaks ties so the split never depends on read order. */
function compareOldestFirst(a: PaymentAllocationInvoice, b: PaymentAllocationInvoice): number {
  return invoiceAgeKey(a) - invoiceAgeKey(b) || a.order_id.localeCompare(b.order_id);
}

/**
 * Posted invoices whose counter-sale returns are still being finalized are held back:
 * finalizing sets `paid_amount` outright, so a payment recorded before it finishes would
 * be overwritten and lost.
 */
function isHeld(invoice: PaymentAllocationInvoice): boolean {
  return invoice.returns_post_status === "pending";
}

/**
 * Plans how `amount` settles `invoices` (one customer's). Drafts and void invoices are
 * ignored: only a posted invoice can take a payment.
 */
export function planCustomerPayment(
  invoices: readonly PaymentAllocationInvoice[],
  amount: number,
): PaymentAllocationPlan {
  const withBalance = invoices
    .filter((invoice) => invoice.status === "posted" && getInvoiceAmountDue(invoice) > SETTLED_EPSILON)
    .sort(compareOldestFirst);

  const held: HeldInvoice[] = withBalance.filter(isHeld).map((invoice) => ({
    invoiceId: invoice.id,
    orderId: invoice.order_id,
    amountDue: getInvoiceAmountDue(invoice),
    reason: "returns_pending",
  }));

  const amountCents = Math.max(0, toCents(amount));
  let remainingCents = amountCents;
  let totalDueCents = 0;

  const lines = withBalance
    .filter((invoice) => !isHeld(invoice))
    .map((invoice): PaymentAllocationLine => {
      const paidBeforeCents = toCents(getInvoicePaidAmount(invoice));
      const dueBeforeCents = toCents(getInvoiceAmountDue(invoice));
      const appliedCents = Math.min(remainingCents, dueBeforeCents);
      remainingCents -= appliedCents;
      totalDueCents += dueBeforeCents;
      const paidAfter = fromCents(paidBeforeCents + appliedCents);
      return {
        invoiceId: invoice.id,
        orderId: invoice.order_id,
        paidBefore: fromCents(paidBeforeCents),
        dueBefore: fromCents(dueBeforeCents),
        applied: fromCents(appliedCents),
        paidAfter,
        dueAfter: fromCents(dueBeforeCents - appliedCents),
        paymentStatusAfter: derivePaymentStatus(invoice, paidAfter),
      };
    });

  return {
    amount: fromCents(amountCents),
    totalDue: fromCents(totalDueCents),
    lines,
    held,
    excess: fromCents(remainingCents),
    dueAfter: fromCents(Math.max(0, totalDueCents - amountCents)),
  };
}

/** The invoices a plan actually changes. */
export function appliedLines(plan: PaymentAllocationPlan): PaymentAllocationLine[] {
  return plan.lines.filter((line) => line.applied > 0);
}

/** Why a plan cannot be recorded, or null when it can. */
export function paymentPlanProblem(plan: PaymentAllocationPlan): PaymentPlanProblem | null {
  if (plan.amount <= 0) return "invalid_amount";
  if (plan.totalDue <= 0) return "nothing_due";
  if (plan.excess > 0) return "exceeds_due";
  return null;
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** The same words for the preview warning and for a refused write. */
export function describePaymentPlanProblem(plan: PaymentAllocationPlan, problem: PaymentPlanProblem): string {
  switch (problem) {
    case "invalid_amount":
      return "Enter a payment amount greater than zero.";
    case "nothing_due":
      return "This customer has nothing due on posted invoices.";
    case "exceeds_due":
      return (
        `${formatMoney(plan.amount)} is ${formatMoney(plan.excess)} more than this customer owes on posted ` +
        `invoices (${formatMoney(plan.totalDue)}), so there is no invoice left to take the rest. ` +
        `Nothing is recorded — lower the amount to ${formatMoney(plan.totalDue)} or less.`
      );
  }
}

/**
 * True when two plans move the same money onto the same invoices. The admin confirms a
 * preview; if balances changed before the write, the write must not quietly apply a
 * different split than the one they saw.
 */
export function samePaymentSplit(
  a: readonly Pick<PaymentAllocationLine, "invoiceId" | "applied">[],
  b: readonly Pick<PaymentAllocationLine, "invoiceId" | "applied">[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (line, i) => line.invoiceId === b[i]!.invoiceId && toCents(line.applied) === toCents(b[i]!.applied),
  );
}
