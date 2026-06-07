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
  invoiceReturns: "invoice_returns",
  invoiceReturnItems: "invoice_return_items",
  returnLotRestorations: "return_lot_restorations",
  returnLotWriteOffs: "return_lot_write_offs",
  inventoryDiscards: "inventory_discards",
  inventoryDiscardItems: "inventory_discard_items",
  inventoryDiscardLots: "inventory_discard_lots",
  /** Single-doc settings, e.g. `settings/cash` for opening cash balance. */
  settings: "settings",
  /** Shop walk-in drafts; lines subcollection `lines`. */
  walkInSessions: "walk_in_sessions",
  /** Audit log for admin customer merges. */
  customerMerges: "customer_merges",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
