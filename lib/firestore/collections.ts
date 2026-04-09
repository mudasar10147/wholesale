/**
 * Firestore collection IDs — single source of truth.
 * @see docs/PHASE2_SCHEMA.md
 * @see docs/INVOICE_SCHEMA.md
 */
export const COLLECTIONS = {
  products: "products",
  sales: "sales",
  expenses: "expenses",
  customers: "customers",
  invoices: "invoices",
  invoiceItems: "invoice_items",
  invoiceItemCogs: "invoice_item_cogs",
  stockLots: "stock_lots",
  lotConsumptions: "lot_consumptions",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
