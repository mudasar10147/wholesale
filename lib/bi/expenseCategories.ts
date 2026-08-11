/**
 * Expense categorisation for Business Intelligence.
 *
 * TradeBridge's `expenses` collection stores only `{ title, amount, date }` —
 * there is no category field. Rather than change the schema (and rather than
 * invent data), this module classifies each expense from the words already in
 * its title, and leaves anything it cannot recognise in an explicit
 * `unclassified` bucket. Nothing is guessed silently.
 *
 * The fixed/variable nature is a property of the category, and categories that
 * are genuinely ambiguous for a wholesale business are marked `unknown` so the
 * forecast does not scale them with revenue on a hunch.
 */

export type ExpenseNature = "fixed" | "variable" | "unknown";

export type ExpenseCategoryId =
  | "delivery"
  | "fuel"
  | "salary"
  | "rent_warehouse"
  | "utilities"
  | "marketing"
  | "packaging"
  | "repairs"
  | "taxes_fees"
  | "losses_damage"
  | "unclassified";

export type ExpenseCategoryDef = {
  id: ExpenseCategoryId;
  label: string;
  nature: ExpenseNature;
  /** Lowercase substrings matched against the expense title. */
  keywords: readonly string[];
  /** Shown in the UI so the owner can see why something landed in this bucket. */
  note: string;
};

/**
 * Order matters: the first definition whose keyword appears in the title wins,
 * so more specific buckets are listed before broader ones.
 */
export const EXPENSE_CATEGORIES: readonly ExpenseCategoryDef[] = [
  {
    id: "salary",
    label: "Salaries & wages",
    nature: "fixed",
    keywords: ["salary", "salaries", "wage", "wages", "payroll", "staff pay", "tankhwa", "bonus"],
    note: "Recurring staff cost — treated as fixed; it does not move with each rupee of sales.",
  },
  {
    id: "rent_warehouse",
    label: "Rent & warehouse",
    nature: "fixed",
    keywords: ["rent", "warehouse", "godown", "store rent", "shop rent", "lease"],
    note: "Premises cost — fixed for the month regardless of sales volume.",
  },
  {
    id: "utilities",
    label: "Utilities",
    nature: "fixed",
    keywords: ["electric", "bijli", "utility", "utilities", "gas bill", "water", "internet", "wifi", "phone bill", "generator"],
    note: "Base facility running cost — mostly fixed month to month.",
  },
  {
    id: "delivery",
    label: "Delivery & freight",
    nature: "variable",
    keywords: ["delivery", "freight", "carriage", "courier", "transport", "loading", "labour", "labor", "cartage", "shipping"],
    note: "Moves with how much stock is shipped — treated as variable with revenue.",
  },
  {
    id: "fuel",
    label: "Fuel",
    nature: "variable",
    keywords: ["fuel", "petrol", "diesel", "cng", "mobil"],
    note: "Scales with delivery runs — treated as variable with revenue.",
  },
  {
    id: "packaging",
    label: "Packaging",
    nature: "variable",
    keywords: ["packing", "packaging", "carton", "bag", "tape", "wrapping", "shopper"],
    note: "Consumed per order — treated as variable with revenue.",
  },
  {
    id: "marketing",
    label: "Marketing",
    nature: "unknown",
    keywords: ["marketing", "advert", "ads", "promo", "banner", "printing", "facebook", "whatsapp pack"],
    note: "Discretionary spend — forecast on its own trend, not scaled with revenue.",
  },
  {
    id: "repairs",
    label: "Repairs & maintenance",
    nature: "unknown",
    keywords: ["repair", "maintenance", "service", "spare", "tyre", "tire", "mechanic"],
    note: "Irregular by nature — forecast on its own trend.",
  },
  {
    id: "taxes_fees",
    label: "Taxes & fees",
    nature: "unknown",
    keywords: ["tax", "fee", "challan", "licen", "bank charge", "commission", "registration"],
    note: "Rules vary — left unscaled unless you classify it yourself.",
  },
  {
    id: "losses_damage",
    label: "Losses & damage",
    nature: "unknown",
    keywords: ["loss", "damage", "damaged", "wast", "expire", "theft", "shortage"],
    note: "Recorded losses booked as spending. Damaged stock written off through inventory is reported separately.",
  },
];

export const UNCLASSIFIED_CATEGORY: ExpenseCategoryDef = {
  id: "unclassified",
  label: "Unclassified",
  nature: "unknown",
  keywords: [],
  note: "The title did not match any known category. Left unclassified rather than guessed.",
};

export function categoryById(id: ExpenseCategoryId): ExpenseCategoryDef {
  return EXPENSE_CATEGORIES.find((c) => c.id === id) ?? UNCLASSIFIED_CATEGORY;
}

/** Classify one expense title. Unrecognised titles return `unclassified`. */
export function classifyExpenseTitle(title: string | undefined | null): ExpenseCategoryDef {
  const normalized = (title ?? "").toLowerCase().trim();
  if (!normalized) return UNCLASSIFIED_CATEGORY;
  for (const category of EXPENSE_CATEGORIES) {
    for (const keyword of category.keywords) {
      if (normalized.includes(keyword)) return category;
    }
  }
  return UNCLASSIFIED_CATEGORY;
}

export type ExpenseInput = {
  title?: string;
  amount?: number;
  date?: Date | null;
};

export type ExpenseCategoryTotal = {
  id: ExpenseCategoryId;
  label: string;
  nature: ExpenseNature;
  note: string;
  amount: number;
  /** Share of total expenses in the period, 0–100. */
  sharePct: number | null;
  count: number;
  /** Same category in the comparison period, when one was supplied. */
  previousAmount: number | null;
  changePct: number | null;
};

export type ExpenseBreakdown = {
  total: number;
  fixed: number;
  variable: number;
  unknown: number;
  categories: ExpenseCategoryTotal[];
  /** Share of total expenses that could not be classified, 0–100. */
  unclassifiedSharePct: number | null;
};

function sumByCategory(expenses: readonly ExpenseInput[]): Map<ExpenseCategoryId, { amount: number; count: number }> {
  const map = new Map<ExpenseCategoryId, { amount: number; count: number }>();
  for (const expense of expenses) {
    const amount = typeof expense.amount === "number" && Number.isFinite(expense.amount) ? expense.amount : 0;
    if (amount === 0) continue;
    const category = classifyExpenseTitle(expense.title);
    const current = map.get(category.id) ?? { amount: 0, count: 0 };
    current.amount += amount;
    current.count += 1;
    map.set(category.id, current);
  }
  return map;
}

/**
 * Totals by category with fixed/variable/unknown splits, plus the same
 * categories in a comparison period when one is supplied.
 */
export function buildExpenseBreakdown(
  expenses: readonly ExpenseInput[],
  previousExpenses: readonly ExpenseInput[] = [],
): ExpenseBreakdown {
  const current = sumByCategory(expenses);
  const previous = sumByCategory(previousExpenses);
  const hasPrevious = previousExpenses.length > 0;

  let total = 0;
  let fixed = 0;
  let variable = 0;
  let unknown = 0;

  const categories: ExpenseCategoryTotal[] = [];
  const ids = new Set<ExpenseCategoryId>([...current.keys(), ...previous.keys()]);

  for (const id of ids) {
    const def = id === "unclassified" ? UNCLASSIFIED_CATEGORY : categoryById(id);
    const amount = current.get(id)?.amount ?? 0;
    const count = current.get(id)?.count ?? 0;
    const previousAmount = hasPrevious ? (previous.get(id)?.amount ?? 0) : null;
    total += amount;
    if (def.nature === "fixed") fixed += amount;
    else if (def.nature === "variable") variable += amount;
    else unknown += amount;

    categories.push({
      id: def.id,
      label: def.label,
      nature: def.nature,
      note: def.note,
      amount,
      sharePct: null,
      count,
      previousAmount,
      changePct:
        previousAmount !== null && previousAmount > 0
          ? ((amount - previousAmount) / previousAmount) * 100
          : null,
    });
  }

  for (const row of categories) {
    row.sharePct = total > 0 ? (row.amount / total) * 100 : null;
  }
  categories.sort((a, b) => b.amount - a.amount);

  const unclassified = categories.find((c) => c.id === "unclassified")?.amount ?? 0;

  return {
    total,
    fixed,
    variable,
    unknown,
    categories,
    unclassifiedSharePct: total > 0 ? (unclassified / total) * 100 : null,
  };
}
