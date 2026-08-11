/**
 * Plain-language definitions for the finance terms on the Business Intelligence
 * page — written for a wholesale owner, not an accountant.
 *
 * Margin and markup are defined separately and deliberately contrasted: a 13%
 * gross margin is NOT a 13% markup.
 */

export type GlossaryTermId =
  | "gross_profit"
  | "net_profit"
  | "gross_margin"
  | "markup"
  | "inventory_turnover"
  | "inventory_days"
  | "working_capital"
  | "cash_conversion_cycle"
  | "receivable_days"
  | "payable_days"
  | "break_even"
  | "margin_of_safety"
  | "purchasing_capacity"
  | "reinvestment"
  | "expense_ratio"
  | "confidence";

export type GlossaryTerm = {
  id: GlossaryTermId;
  title: string;
  /** One-line answer to "what is this?". */
  summary: string;
  /** The arithmetic, written out. */
  formula?: string;
  /** Why it matters for a wholesale business. */
  why?: string;
};

export const GLOSSARY: Record<GlossaryTermId, GlossaryTerm> = {
  gross_profit: {
    id: "gross_profit",
    title: "Gross profit",
    summary: "What is left from sales after paying for the goods you sold — before any running costs.",
    formula: "Gross profit = Revenue − Cost of goods sold",
    why: "It is the money the trading itself earns. Everything else — salaries, delivery, rent — has to come out of this.",
  },
  net_profit: {
    id: "net_profit",
    title: "Net profit",
    summary: "What is actually left after both the cost of goods and the running costs of the business.",
    formula: "Net profit = Gross profit − Operating expenses",
    why: "This is the number that gets reinvested. Buying stock is not counted here — stock is a cash outflow, and only becomes a cost when it sells.",
  },
  gross_margin: {
    id: "gross_margin",
    title: "Gross margin %",
    summary: "Gross profit as a share of the selling price.",
    formula: "Gross margin % = Gross profit ÷ Revenue × 100",
    why: "Sell for Rs. 100 with goods costing Rs. 87 and the margin is 13%. Margin is measured on the selling price — not on the cost.",
  },
  markup: {
    id: "markup",
    title: "Markup %",
    summary: "Gross profit as a share of what the goods cost you. Always a bigger number than the margin.",
    formula: "Markup % = Gross profit ÷ Cost of goods sold × 100",
    why: "The same Rs. 87 cost sold at Rs. 100 is a 13.0% margin but a 14.9% markup. Mixing the two up is the most common wholesale pricing mistake.",
  },
  inventory_turnover: {
    id: "inventory_turnover",
    title: "Inventory turnover",
    summary: "How many times your stock money is sold and replaced during a period.",
    formula: "Turnover = Cost of goods sold ÷ Average inventory",
    why: "The same rupee earning its margin three times a month makes three times the profit of one earning it once.",
  },
  inventory_days: {
    id: "inventory_days",
    title: "Inventory holding days",
    summary: "How many days, on average, stock sits before it sells.",
    formula: "Inventory days = Average inventory ÷ Cost of goods sold × days in period",
    why: "Every extra holding day is another day your money is in the warehouse instead of in the till.",
  },
  working_capital: {
    id: "working_capital",
    title: "Working capital",
    summary: "The money tied up in running the business day to day: cash, stock and what customers owe, less what you owe.",
    formula: "Working capital = Cash + Receivables + Inventory + Loans out − Loans owed",
    why: "It sets the ceiling on how much you can trade. Sales cannot grow past what your capital can carry.",
  },
  cash_conversion_cycle: {
    id: "cash_conversion_cycle",
    title: "Cash conversion cycle",
    summary: "How many days pass between paying for stock and getting that money back as usable cash.",
    formula: "Cycle = Inventory days + Receivable days − Payable days",
    why: "A shorter cycle means the same capital does more trips a year. TradeBridge records no supplier credit, so payable days count as zero unless you start tracking them.",
  },
  receivable_days: {
    id: "receivable_days",
    title: "Customer collection days",
    summary: "How long customers take, on average, to pay you.",
    formula: "Receivable days = Average receivables ÷ Credit sales × days in period",
    why: "Every day shaved off this releases roughly one day of credit sales back into your cash.",
  },
  payable_days: {
    id: "payable_days",
    title: "Supplier payment days",
    summary: "How long you take, on average, to pay suppliers.",
    formula: "Payable days = Average payables ÷ Purchases × days in period",
    why: "Supplier credit is free working capital. TradeBridge does not record supplier balances or terms yet, so this cannot be measured.",
  },
  break_even: {
    id: "break_even",
    title: "Break-even revenue",
    summary: "The monthly sales level at which the business exactly covers all its costs.",
    formula: "Break-even = Fixed costs ÷ (Gross margin % − Variable cost %)",
    why: "Below it you are losing money; above it, each extra rupee of sales adds its contribution straight to profit.",
  },
  margin_of_safety: {
    id: "margin_of_safety",
    title: "Margin of safety",
    summary: "How far current sales sit above the break-even level.",
    formula: "Margin of safety % = (Revenue − Break-even) ÷ Revenue × 100",
    why: "It is the cushion: how much sales could fall before the business starts losing money.",
  },
  purchasing_capacity: {
    id: "purchasing_capacity",
    title: "Inventory purchasing capacity",
    summary: "How much stock the business can afford to buy next month.",
    why: "Not the same as inventory on hand, monthly purchases, or working capital. Capacity is what your cash and collections allow you to spend on stock; purchases are what you actually spend; inventory on hand is what is sitting in the warehouse right now.",
  },
  reinvestment: {
    id: "reinvestment",
    title: "Reinvestment",
    summary: "Profit put back into the business instead of taken out. TradeBridge reinvests 100%.",
    why: "Reinvested profit grows the stock base, which grows what you can sell, which grows profit again. That compounding is the whole growth engine here.",
  },
  expense_ratio: {
    id: "expense_ratio",
    title: "Expense ratio",
    summary: "Running costs as a share of sales.",
    formula: "Expense ratio % = Operating expenses ÷ Revenue × 100",
    why: "If this climbs faster than sales, growth is being eaten by costs. It must stay below the gross margin for the business to make money.",
  },
  confidence: {
    id: "confidence",
    title: "Forecast confidence",
    summary: "How much weight to put on a projection.",
    why: "Based on how many completed months of history exist, how much the business swings month to month, and whether any months are missing data. Low confidence does not mean the number is wrong — it means treat it as a direction, not a target.",
  },
};

export function glossaryTerm(id: GlossaryTermId): GlossaryTerm {
  return GLOSSARY[id];
}
