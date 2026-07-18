/**
 * The only product shape the social planner ever handles. Deliberately excludes
 * `cost_price` — the social manager must never see what we paid.
 */
export type SocialProductRow = {
  id: string;
  name: string;
  category?: string;
  salePrice: number;
  stockQuantity: number;
  imageUrl?: string;
  imagePath?: string;
  /**
   * When the product was created, as epoch ms — used only to show the "New" tag. Safe for
   * the social role (no cost, customer, or supplier data). Absent for pre-existing rows.
   */
  createdAtMs?: number;
};

/** The four data-driven lenses in the suggestions popup. */
export type SuggestionLens = "best_sellers" | "aging_stock" | "new_arrivals" | "overstock";

export const SUGGESTION_LENSES: readonly SuggestionLens[] = [
  "best_sellers",
  "aging_stock",
  "new_arrivals",
  "overstock",
];

export const SUGGESTION_LENS_LABELS: Record<SuggestionLens, string> = {
  best_sellers: "Best sellers",
  aging_stock: "Dead & aging",
  new_arrivals: "New arrivals",
  overstock: "Overstocked",
};

export const SUGGESTION_LENS_HINTS: Record<SuggestionLens, string> = {
  best_sellers: "Top movers — good for a Friday “Products of the week” post.",
  aging_stock: "Sitting unsold. Post these, or discount them.",
  new_arrivals: "Recently received stock. Share one a day.",
  overstock: "Lots on hand, selling slowly. Clear the shelf.",
};

/** A tab in the suggestions popup: the four data lenses, plus a plain random shuffle. */
export type SuggestionSource = "random" | SuggestionLens;

export const SUGGESTION_SOURCES: readonly SuggestionSource[] = ["random", ...SUGGESTION_LENSES];

/**
 * What `/api/social/suggestions` returns. Every field here is safe for the social role:
 * no cost price, no customer, no supplier, no margin.
 */
export type SuggestionRow = SocialProductRow & {
  /** Human-readable metric for this lens, e.g. "42 sold in 30d". */
  metricLabel: string;
  /** The raw number the rows are ranked by. */
  metricValue: number;
};

export type SuggestionsResponse = {
  lens: SuggestionLens;
  days: number;
  rows: SuggestionRow[];
};
