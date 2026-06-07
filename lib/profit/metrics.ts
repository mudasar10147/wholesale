import type { ExpenseDoc, SaleDoc } from "@/lib/types/firestore";

export type ProfitBreakdown = {
  totalSales: number;
  totalExpenses: number;
  cogs: number;
  /** FIFO discard write-offs from posted returns (informational; already in sale COGS). */
  damagedWriteOffs: number;
  profit: number;
};

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * COGS from sales rows. Prefers signed `cogs_amount` when set (invoice + return rows).
 * Falls back to product cost_price × qty for legacy walk-in rows.
 */
export function computeCogs(
  sales: Pick<SaleDoc, "product_id" | "quantity" | "cogs_amount">[],
  costByProductId: Map<string, number>,
): number {
  let cogs = 0;
  for (const s of sales) {
    if (typeof s.cogs_amount === "number" && Number.isFinite(s.cogs_amount)) {
      cogs += s.cogs_amount;
      continue;
    }
    const unit =
      typeof costByProductId.get(s.product_id) === "number"
        ? costByProductId.get(s.product_id)!
        : 0;
    const qty = typeof s.quantity === "number" ? s.quantity : 0;
    cogs += unit * qty;
  }
  return roundMoney2(cogs);
}

export function sumSaleAmounts(sales: Pick<SaleDoc, "total_amount">[]): number {
  return sales.reduce((acc, s) => acc + (typeof s.total_amount === "number" ? s.total_amount : 0), 0);
}

export function sumExpenseAmounts(expenses: Pick<ExpenseDoc, "amount">[]): number {
  return expenses.reduce((acc, e) => acc + (typeof e.amount === "number" ? e.amount : 0), 0);
}

/**
 * Profit = Total Sales − Total Expenses − COGS (per PROJECT_SPEC.md).
 */
export function computeProfitBreakdown(
  sales: SaleDoc[],
  expenses: ExpenseDoc[],
  costByProductId: Map<string, number>,
  damagedWriteOffs = 0,
): ProfitBreakdown {
  const totalSales = sumSaleAmounts(sales);
  const totalExpenses = sumExpenseAmounts(expenses);
  const cogs = computeCogs(sales, costByProductId);
  const profit = totalSales - totalExpenses - cogs;
  return {
    totalSales,
    totalExpenses,
    cogs,
    damagedWriteOffs: roundMoney2(damagedWriteOffs),
    profit,
  };
}

/** Gross margin % = (sales − COGS) / sales. Null when sales ≤ 0. */
export function grossMarginPercent(
  b: Pick<ProfitBreakdown, "totalSales" | "cogs">,
): number | null {
  const sales = b.totalSales;
  if (!Number.isFinite(sales) || sales <= 0) return null;
  return ((sales - b.cogs) / sales) * 100;
}

/** Net margin % = profit / sales. Null when sales ≤ 0. */
export function netMarginPercent(b: Pick<ProfitBreakdown, "totalSales" | "profit">): number | null {
  const sales = b.totalSales;
  if (!Number.isFinite(sales) || sales <= 0) return null;
  return (b.profit / sales) * 100;
}
