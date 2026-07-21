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
  /** Suppliers we buy stock from. */
  traders: "traders",
  /** People/companies tied to manual cash entries (owner, investor, lender, bank…). */
  parties: "parties",
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
  /** Warehouses / locations for inventory (single default in phase 1). */
  warehouses: "warehouses",
  /** Posted inventory movement headers (ERP ledger). */
  inventoryTransactions: "inventory_transactions",
  inventoryTransactionLines: "inventory_transaction_lines",
  /** Immutable repair audit records (M0.5 baseline remediation + M6 workflow). */
  inventoryRepairs: "inventory_repairs",
  /** Schema migration manifest. */
  schemaMigrations: "schema_migrations",
  /** Shadow engine parity diffs (dev/ops). */
  inventoryShadowDiffs: "inventory_shadow_diffs",
  /** Planned WhatsApp posts, one doc per scheduled slot. */
  socialPosts: "social_posts",
  /** Discount campaigns a planned post can advertise. */
  socialOffers: "social_offers",
  /** Free-form weekly notepad; doc id is the ISO week key, e.g. `2026-W29`. */
  socialNotes: "social_notes",
  /** Approval state of one week's plan; doc id is the ISO week key. */
  socialWeekPlans: "social_week_plans",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
