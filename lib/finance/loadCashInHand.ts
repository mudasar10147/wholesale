import { collection, getDocs, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { fetchCashSettings, getActualCashBalance, getOpeningBalance } from "@/lib/firestore/cashSettings";
import { fetchAllCashEntries } from "@/lib/firestore/cashEntries";
import type { ExpenseDoc, InvoiceDoc, SaleDoc, StockLotDoc } from "@/lib/types/firestore";

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CashInHandBreakdown = {
  openingBalance: number;
  /** Walk-in / quick sales not tied to an invoice (`sales` without `invoice_id`). */
  cashWalkInSales: number;
  /** Sum of `paid_amount` on posted, non-void invoices. */
  cashInvoicePayments: number;
  totalExpenses: number;
  manualCashAdded: number;
  manualCashRemoved: number;
  /** Cash paid for inventory receipts (`stock_lots` with `source: stock_in`). */
  stockPurchasesCash: number;
};

export type CashInHandSnapshot = CashInHandBreakdown & {
  operationalCash: number;
  expectedCashNow: number;
  actualCashBalance: number | null;
  totalCashInHand: number;
};

/**
 * Estimated cash on hand: opening balance + cash-style inflows − outflows.
 * Invoice revenue uses collections (`paid_amount`), not posted line totals.
 */
export async function loadCashInHandSnapshot(db: Firestore): Promise<CashInHandSnapshot> {
  const [settings, salesSnap, expensesSnap, invoicesSnap, lotsSnap, cashEntries] = await Promise.all([
    fetchCashSettings(db),
    getDocs(collection(db, COLLECTIONS.sales)),
    getDocs(collection(db, COLLECTIONS.expenses)),
    getDocs(collection(db, COLLECTIONS.invoices)),
    getDocs(collection(db, COLLECTIONS.stockLots)),
    fetchAllCashEntries(db),
  ]);

  let cashWalkInSales = 0;
  salesSnap.forEach((d) => {
    const s = d.data() as SaleDoc;
    const inv = s.invoice_id;
    if (typeof inv === "string" && inv.trim().length > 0) {
      return;
    }
    const amt = typeof s.total_amount === "number" ? s.total_amount : 0;
    if (Number.isFinite(amt)) {
      cashWalkInSales += amt;
    }
  });

  let totalExpenses = 0;
  expensesSnap.forEach((d) => {
    const e = d.data() as ExpenseDoc;
    const amt = typeof e.amount === "number" ? e.amount : 0;
    if (Number.isFinite(amt)) {
      totalExpenses += amt;
    }
  });

  let cashInvoicePayments = 0;
  invoicesSnap.forEach((d) => {
    const inv = d.data() as InvoiceDoc;
    if (inv.status === "void" || inv.status !== "posted") {
      return;
    }
    const paid = typeof inv.paid_amount === "number" ? inv.paid_amount : 0;
    if (Number.isFinite(paid)) {
      cashInvoicePayments += paid;
    }
  });

  let stockPurchasesCash = 0;
  lotsSnap.forEach((d) => {
    const lot = d.data() as StockLotDoc;
    if (lot.source !== "stock_in") {
      return;
    }
    const uc = typeof lot.unit_cost === "number" ? lot.unit_cost : 0;
    const q = typeof lot.qty_in === "number" ? lot.qty_in : 0;
    if (Number.isFinite(uc) && Number.isFinite(q)) {
      stockPurchasesCash += uc * q;
    }
  });

  let manualCashAdded = 0;
  let manualCashRemoved = 0;
  for (const entry of cashEntries) {
    const amount = typeof entry.amount === "number" ? entry.amount : 0;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (entry.entry_type === "add") manualCashAdded += amount;
    if (entry.entry_type === "remove") manualCashRemoved += amount;
  }

  const openingBalance = getOpeningBalance(settings);
  const actualCashBalance = getActualCashBalance(settings);

  const operationalCash = roundMoney2(
    cashWalkInSales + cashInvoicePayments - totalExpenses - stockPurchasesCash,
  );
  const expectedCashNow = roundMoney2(
    openingBalance + manualCashAdded - manualCashRemoved + operationalCash,
  );

  const totalCashInHand = expectedCashNow;

  return {
    openingBalance,
    cashWalkInSales: roundMoney2(cashWalkInSales),
    cashInvoicePayments: roundMoney2(cashInvoicePayments),
    totalExpenses: roundMoney2(totalExpenses),
    manualCashAdded: roundMoney2(manualCashAdded),
    manualCashRemoved: roundMoney2(manualCashRemoved),
    stockPurchasesCash: roundMoney2(stockPurchasesCash),
    operationalCash,
    expectedCashNow,
    actualCashBalance,
    totalCashInHand,
  };
}
