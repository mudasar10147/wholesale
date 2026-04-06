import type { ExpenseDoc, SaleDoc } from "@/lib/types/firestore";

export type ProfitBreakdown = {
  totalSales: number;
  totalExpenses: number;
  cogs: number;
  profit: number;
};

/**
 * COGS = sum over sales of (product cost_price × quantity).
 * Uses current product `cost_price` from `costByProductId` (MVP; historical cost not stored on sale).
 */
export function computeCogs(
  sales: Pick<SaleDoc, "product_id" | "quantity">[],
  costByProductId: Map<string, number>,
): number {
  let cogs = 0;
  for (const s of sales) {
    const unit =
      typeof costByProductId.get(s.product_id) === "number"
        ? costByProductId.get(s.product_id)!
        : 0;
    const qty = typeof s.quantity === "number" ? s.quantity : 0;
    cogs += unit * qty;
  }
  return cogs;
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
): ProfitBreakdown {
  const totalSales = sumSaleAmounts(sales);
  const totalExpenses = sumExpenseAmounts(expenses);
  const cogs = computeCogs(sales, costByProductId);
  const profit = totalSales - totalExpenses - cogs;
  return { totalSales, totalExpenses, cogs, profit };
}
