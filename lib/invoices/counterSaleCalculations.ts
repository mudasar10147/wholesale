/**
 * Pure money math for a "counter-sale" invoice: new sale lines net against inline return
 * lines (items the customer is handing back), refunding any excess in cash.
 *
 * Firestore-free and side-effect-free so it drives both the form preview and the write path,
 * and is unit-tested. Return line credits are computed at the ORIGINAL price the customer
 * paid (see `calculateReturnSummary` in `returnCalculations.ts`) and passed in here as
 * `line_total`s — this helper only nets them against the sale.
 */

export type CounterSaleReturnCredit = {
  /** Proportional credit for this return line, at the original sale price. */
  line_total: number;
};

export type CounterSaleSummary = {
  /** Total of the new sale lines (from `calculateInvoiceSummary`). */
  sale_total: number;
  /** Sum of return line credits, R. */
  returns_credit_amount: number;
  /** Credit consumed by this invoice, min(sale, R) — booked as paid_amount. */
  applied_credit: number;
  /** What the customer still owes on this invoice, max(0, sale − R). */
  net_amount_due: number;
  /** Excess returned value handed back as cash, max(0, R − sale). */
  cash_refund_amount: number;
};

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function sumReturnsCredit(returnLines: readonly CounterSaleReturnCredit[]): number {
  return roundMoney2(
    returnLines.reduce((acc, line) => acc + (Number.isFinite(line.line_total) ? line.line_total : 0), 0),
  );
}

export function calculateCounterSaleSummary(
  saleTotal: number,
  returnLines: readonly CounterSaleReturnCredit[],
): CounterSaleSummary {
  const sale = roundMoney2(Math.max(0, Number.isFinite(saleTotal) ? saleTotal : 0));
  const credit = sumReturnsCredit(returnLines);
  const applied = roundMoney2(Math.min(sale, credit));
  return {
    sale_total: sale,
    returns_credit_amount: credit,
    applied_credit: applied,
    net_amount_due: roundMoney2(Math.max(0, sale - credit)),
    cash_refund_amount: roundMoney2(Math.max(0, credit - sale)),
  };
}
