/**
 * Firestore collection IDs — single source of truth for Phase 2+ features.
 * @see docs/PHASE2_SCHEMA.md
 */
export const COLLECTIONS = {
  products: "products",
  sales: "sales",
  expenses: "expenses",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
