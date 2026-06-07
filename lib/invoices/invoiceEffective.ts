import type { InvoiceDoc } from "@/lib/types/firestore";

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function getInvoicePostedTotal(invoice: InvoiceDoc): number {
  return roundMoney2(
    typeof invoice.posted_total_amount === "number" ? invoice.posted_total_amount : invoice.total_amount,
  );
}

export function getInvoiceReturnedAmount(invoice: InvoiceDoc): number {
  return roundMoney2(typeof invoice.returned_amount === "number" ? invoice.returned_amount : 0);
}

export function getInvoiceEffectiveTotal(invoice: InvoiceDoc): number {
  return roundMoney2(Math.max(0, getInvoicePostedTotal(invoice) - getInvoiceReturnedAmount(invoice)));
}

export function getInvoicePaidAmount(invoice: InvoiceDoc): number {
  const paid = roundMoney2(typeof invoice.paid_amount === "number" ? invoice.paid_amount : 0);
  const effective = getInvoiceEffectiveTotal(invoice);
  return roundMoney2(Math.min(Math.max(0, paid), effective));
}

export function getInvoiceAmountDue(invoice: InvoiceDoc): number {
  return roundMoney2(Math.max(0, getInvoiceEffectiveTotal(invoice) - getInvoicePaidAmount(invoice)));
}

export type InvoiceLineReturnBreakdown = {
  soldQty: number;
  returnedQty: number;
  netQty: number;
  soldLineTotal: number;
  returnedLineTotal: number;
  effectiveLineTotal: number;
};

/** Proportional return credit per invoice line (matches return posting math). */
export function getInvoiceLineReturnBreakdown(
  soldQty: number,
  lineTotal: number,
  returnedQty: number,
): InvoiceLineReturnBreakdown {
  const sold = Math.max(0, Math.trunc(soldQty));
  const returned = Math.min(Math.max(0, Math.trunc(returnedQty)), sold);
  const netQty = sold - returned;
  const soldLineTotal = roundMoney2(lineTotal);
  if (returned <= 0 || sold <= 0) {
    return {
      soldQty: sold,
      returnedQty: 0,
      netQty: sold,
      soldLineTotal,
      returnedLineTotal: 0,
      effectiveLineTotal: soldLineTotal,
    };
  }
  const ratio = returned / sold;
  const returnedLineTotal = roundMoney2(lineTotal * ratio);
  const effectiveLineTotal = roundMoney2(lineTotal - returnedLineTotal);
  return {
    soldQty: sold,
    returnedQty: returned,
    netQty,
    soldLineTotal,
    returnedLineTotal,
    effectiveLineTotal,
  };
}

export function derivePaymentStatus(
  invoice: InvoiceDoc,
  paidAmount: number,
): "unpaid" | "partial" | "paid" {
  const effective = getInvoiceEffectiveTotal(invoice);
  const paid = roundMoney2(paidAmount);
  if (effective <= 0 || paid <= 0) return "unpaid";
  if (paid >= effective - 0.01) return "paid";
  return "partial";
}
