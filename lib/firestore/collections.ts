/**
 * Firestore collection IDs — single source of truth.
 * @see docs/PHASE2_SCHEMA.md
 * @see docs/INVOICE_SCHEMA.md
 */
export const COLLECTIONS = {
  products: "products",
  sales: "sales",
  expenses: "expenses",
  cashEntries: "cash_entries",
  customers: "customers",
  invoices: "invoices",
  invoiceItems: "invoice_items",
  invoiceItemCogs: "invoice_item_cogs",
  stockLots: "stock_lots",
  lotConsumptions: "lot_consumptions",
  /** Single-doc settings, e.g. `settings/cash` for opening cash balance. */
  settings: "settings",
  /** Shop walk-in drafts; lines subcollection `lines`. */
  walkInSessions: "walk_in_sessions",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
