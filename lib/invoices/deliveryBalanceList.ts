import type { InvoiceDoc } from "@/lib/types/firestore";
import {
  getInvoiceAmountDue,
  getInvoiceEffectiveTotal,
  getInvoicePaidAmount,
} from "./invoiceEffective.ts";

export type DeliveryBalanceInvoiceInput = Pick<
  InvoiceDoc,
  | "customer_id"
  | "order_id"
  | "status"
  | "total_amount"
  | "item_ids"
  | "paid_amount"
  | "posted_total_amount"
  | "returned_amount"
  | "payment_status"
  | "notes"
> & {
  id: string;
  created_at?: { toDate(): Date } | null;
};

export type DeliveryBalanceCustomerInput = {
  name?: string;
  phone?: string;
  address?: string;
};

export type DeliveryBalanceRow = {
  invoiceId: string;
  orderId: string;
  statusLabel: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  itemCount: number;
  invoiceTotal: number;
  paidAmount: number;
  balanceDue: number;
  createdAt: Date | null;
  notes: string;
};

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function invoiceHasRemainingBalance(invoice: DeliveryBalanceInvoiceInput): boolean {
  if (invoice.status === "void") return false;
  if (invoice.status === "draft") {
    return roundMoney2(invoice.total_amount) > 0.01;
  }
  if (invoice.status === "posted") {
    return getInvoiceAmountDue(invoice) > 0.01;
  }
  return false;
}

export function getDeliveryBalanceDue(invoice: DeliveryBalanceInvoiceInput): number {
  if (invoice.status === "void") return 0;
  if (invoice.status === "draft") {
    return roundMoney2(invoice.total_amount);
  }
  if (invoice.status === "posted") {
    return getInvoiceAmountDue(invoice);
  }
  return 0;
}

export function deliveryStatusLabel(invoice: DeliveryBalanceInvoiceInput): string {
  if (invoice.status === "draft") return "Draft";
  const paid = getInvoicePaidAmount(invoice);
  const due = getInvoiceAmountDue(invoice);
  if (paid > 0.01 && due > 0.01) return "Partial paid";
  return "Posted";
}

export function buildDeliveryBalanceRow(
  invoice: DeliveryBalanceInvoiceInput,
  customer: DeliveryBalanceCustomerInput | undefined,
): DeliveryBalanceRow {
  const invoiceTotal =
    invoice.status === "posted"
      ? getInvoiceEffectiveTotal(invoice)
      : roundMoney2(invoice.total_amount);
  const paidAmount = invoice.status === "posted" ? getInvoicePaidAmount(invoice) : 0;
  const balanceDue = getDeliveryBalanceDue(invoice);

  let createdAt: Date | null = null;
  try {
    createdAt = invoice.created_at?.toDate() ?? null;
  } catch {
    createdAt = null;
  }

  return {
    invoiceId: invoice.id,
    orderId: invoice.order_id,
    statusLabel: deliveryStatusLabel(invoice),
    customerName: customer?.name?.trim() || "—",
    customerPhone: customer?.phone?.trim() || "—",
    customerAddress: customer?.address?.trim() || "—",
    itemCount: invoice.item_ids?.length ?? 0,
    invoiceTotal,
    paidAmount,
    balanceDue,
    createdAt,
    notes: invoice.notes?.trim() || "",
  };
}

export function buildDeliveryBalanceList(
  invoices: readonly DeliveryBalanceInvoiceInput[],
  customerById: ReadonlyMap<string, DeliveryBalanceCustomerInput>,
): DeliveryBalanceRow[] {
  const rows = invoices
    .filter(invoiceHasRemainingBalance)
    .map((invoice) =>
      buildDeliveryBalanceRow(invoice, customerById.get(invoice.customer_id)),
    );

  return rows.sort((a, b) => {
    const byCustomer = a.customerName.localeCompare(b.customerName, undefined, {
      sensitivity: "base",
    });
    if (byCustomer !== 0) return byCustomer;
    return a.orderId.localeCompare(b.orderId, undefined, { sensitivity: "base" });
  });
}

export function sumDeliveryBalanceDue(rows: readonly DeliveryBalanceRow[]): number {
  return roundMoney2(rows.reduce((sum, row) => sum + row.balanceDue, 0));
}
