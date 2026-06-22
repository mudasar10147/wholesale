import type { InvoiceDoc } from "@/lib/types/firestore";
import {
  getInvoiceAmountDue,
  getInvoiceEffectiveTotal,
  getInvoicePaidAmount,
} from "@/lib/invoices/invoiceEffective";

export type InvoiceListTab = "all" | "draft" | "posted" | "unpaid" | "partial" | "paid" | "void";

export const INVOICE_LIST_TABS: ReadonlyArray<{ id: InvoiceListTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "posted", label: "Posted" },
  { id: "unpaid", label: "Unpaid" },
  { id: "partial", label: "Partial paid" },
  { id: "paid", label: "Paid" },
  { id: "void", label: "Void" },
];

export type InvoicePaymentBucket = "paid" | "partial" | "unpaid";

/** Payment bucket for posted invoices only. */
export function classifyInvoicePayment(row: InvoiceDoc): InvoicePaymentBucket | null {
  if (row.status !== "posted") return null;

  const amountDue = getInvoiceAmountDue(row);
  const paidAmount = getInvoicePaidAmount(row);
  const effectiveTotal = getInvoiceEffectiveTotal(row);
  const isFullyPaid = row.payment_status === "paid" || amountDue <= 0.01;

  if (isFullyPaid && effectiveTotal > 0.01) return "paid";
  if (paidAmount > 0.01 && amountDue > 0.01) return "partial";
  return "unpaid";
}

export function matchesInvoiceTab(row: InvoiceDoc, tab: InvoiceListTab): boolean {
  if (tab === "all") return true;
  if (tab === "draft") return row.status === "draft";
  if (tab === "void") return row.status === "void";
  if (tab === "posted") return row.status === "posted";

  const payment = classifyInvoicePayment(row);
  if (tab === "paid") return payment === "paid";
  if (tab === "partial") return payment === "partial";
  if (tab === "unpaid") return payment === "unpaid";
  return true;
}

export function countInvoicesByTab(rows: InvoiceDoc[]): Record<InvoiceListTab, number> {
  const counts: Record<InvoiceListTab, number> = {
    all: rows.length,
    draft: 0,
    posted: 0,
    unpaid: 0,
    partial: 0,
    paid: 0,
    void: 0,
  };

  for (const row of rows) {
    if (row.status === "draft") counts.draft += 1;
    if (row.status === "void") counts.void += 1;
    if (row.status === "posted") {
      counts.posted += 1;
      const payment = classifyInvoicePayment(row);
      if (payment === "paid") counts.paid += 1;
      else if (payment === "partial") counts.partial += 1;
      else if (payment === "unpaid") counts.unpaid += 1;
    }
  }

  return counts;
}
