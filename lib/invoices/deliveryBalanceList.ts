import type { InvoiceDoc } from "@/lib/types/firestore";
import {
  getInvoiceAmountDue,
  getInvoiceEffectiveTotal,
  getInvoicePaidAmount,
  getInvoicePostedTotal,
  getInvoiceReturnedAmount,
} from "@/lib/invoices/invoiceEffective";

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
  | "returns_credit_amount"
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

/**
 * One product handed back against an invoice, split into resellable (restock) and
 * damaged (discard) units — what the salesman needs to reconcile goods at the shop.
 */
export type DeliveryReturnLine = {
  productId: string;
  productName: string;
  quantityReturned: number;
  quantityRestock: number;
  quantityDiscard: number;
  creditAmount: number;
  /**
   * False for `credit_note` returns: the goods came back but the credit was settled on a
   * different invoice, so this invoice's balance is untouched.
   */
  reducesBalance: boolean;
};

export type DeliveryBalanceRow = {
  invoiceId: string;
  orderId: string;
  statusLabel: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  itemCount: number;
  /** Gross invoice value before any return credit. */
  invoiceTotal: number;
  /** Return credit applied against THIS invoice. */
  returnedAmount: number;
  /** invoiceTotal - returnedAmount. */
  netTotal: number;
  paidAmount: number;
  balanceDue: number;
  createdAt: Date | null;
  notes: string;
  returnLines: DeliveryReturnLine[];
};

export type DeliveryBalanceCustomerGroup = {
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  rows: DeliveryBalanceRow[];
  invoiceCount: number;
  totalInvoiced: number;
  totalReturned: number;
  totalPaid: number;
  totalDue: number;
};

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Credit from inline counter-sale return lines that nets against a DRAFT invoice.
 * Capped at the sale total — any excess is handed back as cash, not carried as balance.
 */
export function getDraftReturnCredit(invoice: DeliveryBalanceInvoiceInput): number {
  const credit = roundMoney2(
    typeof invoice.returns_credit_amount === "number" ? invoice.returns_credit_amount : 0,
  );
  const gross = roundMoney2(invoice.total_amount);
  return roundMoney2(Math.min(Math.max(0, credit), Math.max(0, gross)));
}

export function invoiceHasRemainingBalance(invoice: DeliveryBalanceInvoiceInput): boolean {
  return getDeliveryBalanceDue(invoice) > 0.01;
}

export function getDeliveryBalanceDue(invoice: DeliveryBalanceInvoiceInput): number {
  if (invoice.status === "void") return 0;
  if (invoice.status === "draft") {
    return roundMoney2(Math.max(0, roundMoney2(invoice.total_amount) - getDraftReturnCredit(invoice)));
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
  returnLines: readonly DeliveryReturnLine[] = [],
): DeliveryBalanceRow {
  const isPosted = invoice.status === "posted";
  const invoiceTotal = isPosted
    ? getInvoicePostedTotal(invoice)
    : roundMoney2(invoice.total_amount);
  const returnedAmount = isPosted
    ? getInvoiceReturnedAmount(invoice)
    : getDraftReturnCredit(invoice);
  const netTotal = isPosted
    ? getInvoiceEffectiveTotal(invoice)
    : roundMoney2(Math.max(0, invoiceTotal - returnedAmount));
  const paidAmount = isPosted ? getInvoicePaidAmount(invoice) : 0;
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
    customerId: invoice.customer_id,
    customerName: customer?.name?.trim() || "Unknown customer",
    customerPhone: customer?.phone?.trim() || "-",
    customerAddress: customer?.address?.trim() || "-",
    itemCount: invoice.item_ids?.length ?? 0,
    invoiceTotal,
    returnedAmount,
    netTotal,
    paidAmount,
    balanceDue,
    createdAt,
    notes: invoice.notes?.trim() || "",
    returnLines: [...returnLines],
  };
}

export function buildDeliveryBalanceList(
  invoices: readonly DeliveryBalanceInvoiceInput[],
  customerById: ReadonlyMap<string, DeliveryBalanceCustomerInput>,
  returnLinesByInvoiceId: ReadonlyMap<string, DeliveryReturnLine[]> = new Map(),
): DeliveryBalanceRow[] {
  const rows = invoices
    .filter(invoiceHasRemainingBalance)
    .map((invoice) =>
      buildDeliveryBalanceRow(
        invoice,
        customerById.get(invoice.customer_id),
        returnLinesByInvoiceId.get(invoice.id) ?? [],
      ),
    );

  return rows.sort(compareDeliveryRows);
}

/** Oldest invoice first inside a shop — the salesman collects the stalest debt first. */
function compareDeliveryRows(a: DeliveryBalanceRow, b: DeliveryBalanceRow): number {
  const byCustomer = a.customerName.localeCompare(b.customerName, undefined, {
    sensitivity: "base",
  });
  if (byCustomer !== 0) return byCustomer;
  const aTime = a.createdAt ? a.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.createdAt ? b.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return a.orderId.localeCompare(b.orderId, undefined, { sensitivity: "base" });
}

/**
 * Collapse rows into one block per shop: customer details printed once, every unpaid
 * invoice of that shop listed beneath it, with a shop-level closing balance.
 */
export function groupDeliveryBalanceRows(
  rows: readonly DeliveryBalanceRow[],
): DeliveryBalanceCustomerGroup[] {
  const groups = new Map<string, DeliveryBalanceCustomerGroup>();

  for (const row of rows) {
    const key = row.customerId || `name:${row.customerName.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        customerId: row.customerId,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        customerAddress: row.customerAddress,
        rows: [],
        invoiceCount: 0,
        totalInvoiced: 0,
        totalReturned: 0,
        totalPaid: 0,
        totalDue: 0,
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  const out = [...groups.values()];
  for (const group of out) {
    group.rows.sort(compareDeliveryRows);
    group.invoiceCount = group.rows.length;
    group.totalInvoiced = roundMoney2(group.rows.reduce((s, r) => s + r.invoiceTotal, 0));
    group.totalReturned = roundMoney2(group.rows.reduce((s, r) => s + r.returnedAmount, 0));
    group.totalPaid = roundMoney2(group.rows.reduce((s, r) => s + r.paidAmount, 0));
    group.totalDue = roundMoney2(group.rows.reduce((s, r) => s + r.balanceDue, 0));
  }

  return out.sort((a, b) =>
    a.customerName.localeCompare(b.customerName, undefined, { sensitivity: "base" }),
  );
}

export function buildDeliveryBalanceGroups(
  invoices: readonly DeliveryBalanceInvoiceInput[],
  customerById: ReadonlyMap<string, DeliveryBalanceCustomerInput>,
  returnLinesByInvoiceId: ReadonlyMap<string, DeliveryReturnLine[]> = new Map(),
): DeliveryBalanceCustomerGroup[] {
  return groupDeliveryBalanceRows(
    buildDeliveryBalanceList(invoices, customerById, returnLinesByInvoiceId),
  );
}

export function sumDeliveryBalanceDue(rows: readonly DeliveryBalanceRow[]): number {
  return roundMoney2(rows.reduce((sum, row) => sum + row.balanceDue, 0));
}

export function sumGroupsBalanceDue(
  groups: readonly DeliveryBalanceCustomerGroup[],
): number {
  return roundMoney2(groups.reduce((sum, group) => sum + group.totalDue, 0));
}

export function countGroupInvoices(
  groups: readonly DeliveryBalanceCustomerGroup[],
): number {
  return groups.reduce((sum, group) => sum + group.invoiceCount, 0);
}
