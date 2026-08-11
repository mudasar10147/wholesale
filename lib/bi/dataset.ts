/**
 * The single raw dataset every Business Intelligence calculation reads from.
 *
 * Loaded once per page visit (`loadBusinessDataset`) and then analysed purely in
 * memory, so no analytic section issues its own queries. Nothing here is
 * derived — derivations live in the analytics modules.
 */
import type {
  CashEntryDoc,
  CustomerDoc,
  ExpenseDoc,
  InventoryDiscardDoc,
  InvoiceDoc,
  InvoiceReturnDoc,
  ProductDoc,
  SaleDoc,
  StockLotDoc,
  TraderDoc,
} from "@/lib/types/firestore";

export type WithId<T> = { id: string; data: T };

export type BusinessDataset = {
  /** When the snapshot was taken; every "today"-relative metric uses this. */
  now: Date;
  /** Sales rows are only loaded from here onward (see `SALES_HISTORY_MONTHS`). */
  historyStart: Date;
  products: WithId<ProductDoc>[];
  sales: WithId<SaleDoc>[];
  expenses: WithId<ExpenseDoc>[];
  invoices: WithId<InvoiceDoc>[];
  stockLots: WithId<StockLotDoc>[];
  cashEntries: WithId<CashEntryDoc>[];
  customers: WithId<CustomerDoc>[];
  traders: WithId<TraderDoc>[];
  invoiceReturns: WithId<InvoiceReturnDoc>[];
  inventoryDiscards: WithId<InventoryDiscardDoc>[];
  cashOpeningBalance: number;
  actualCashBalance: number | null;
};

/** How far back sales/expenses are loaded: 24 months covers a 12-month view plus its comparison. */
export const SALES_HISTORY_MONTHS = 24;

/** Local start-of-day, `months` whole calendar months before the 1st of `now`'s month. */
export function historyStartFor(now: Date, months = SALES_HISTORY_MONTHS): Date {
  return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1, 0, 0, 0, 0);
}

export function timestampToDate(value: unknown): Date | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as { toDate?: () => Date; toMillis?: () => number };
  try {
    if (typeof maybe.toDate === "function") {
      const d = maybe.toDate();
      return Number.isFinite(d?.getTime?.()) ? d : null;
    }
    if (typeof maybe.toMillis === "function") {
      const ms = maybe.toMillis();
      return Number.isFinite(ms) ? new Date(ms) : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** IDs of invoices that were voided — their sales rows must never enter reporting. */
export function voidInvoiceIdSet(invoices: readonly WithId<InvoiceDoc>[]): Set<string> {
  const ids = new Set<string>();
  for (const inv of invoices) {
    if (inv.data.status === "void") ids.add(inv.id);
  }
  return ids;
}
