import type { Timestamp } from "firebase/firestore";

/**
 * Document shape for `products/{productId}`.
 * Field names use snake_case to match docs/PROJECT_SPEC.md.
 */
export type PricingMode = "manual" | "automatic";

export type ProductDoc = {
  name: string;
  category?: string;
  image_url?: string;
  image_path?: string;
  image_mime?: string;
  image_size?: number;
  image_updated_at?: Timestamp;
  cost_price: number;
  sale_price: number;
  stock_quantity: number;
  /** Target gross margin % (selling-price basis). Falls back to category template then global default. */
  target_margin_percent?: number;
  pricing_mode?: PricingMode;
  pricing_updated_at?: Timestamp;
  created_at: Timestamp;
};

/**
 * Document shape for `sales/{saleId}`.
 * `product_id` references `products/{product_id}`.
 */
export type SaleType = "sale" | "return";

export type SaleDoc = {
  invoice_id?: string;
  /** Original invoice when this row is a return offset. */
  original_invoice_id?: string;
  return_id?: string;
  sale_type?: SaleType;
  /** Set when sale was created from an approved walk-in session. */
  walk_in_session_id?: string;
  order_id?: string;
  customer_id?: string;
  product_id: string;
  quantity: number;
  sale_price: number;
  unit_cost?: number;
  line_subtotal?: number;
  line_discount?: number;
  line_delivery_charge?: number;
  cogs_amount?: number;
  total_amount: number;
  posted_at?: Timestamp;
  date: Timestamp;
};

export type WalkInSessionStatus = "pending" | "approved" | "rejected";

/**
 * `walk_in_sessions/{sessionId}` — pending shop sale until admin approves.
 */
export type WalkInSessionDoc = {
  status: WalkInSessionStatus;
  payment_status?: "paid" | "unpaid";
  /** Start of local calendar day for reporting (same day as walk-in business date). */
  sale_date: Timestamp;
  /** Denormalized count of lines (for list UI). */
  line_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by_uid?: string;
  approved_at?: Timestamp;
  approved_by_uid?: string;
  paid_at?: Timestamp;
  rejection_note?: string;
};

/**
 * `walk_in_sessions/{sessionId}/lines/{lineId}`.
 */
export type WalkInLineDoc = {
  product_id: string;
  quantity: number;
  unit_sale_price: number;
  created_at: Timestamp;
};

/**
 * Document shape for `expenses/{expenseId}`.
 */
export type ExpenseDoc = {
  title: string;
  amount: number;
  date: Timestamp;
};

export type CashEntryType = "add" | "remove";

/**
 * Loan classification for a cash entry. Presence of this field marks the entry
 * as a loan movement (must also have a `party_id`). The cash direction is
 * derived from the kind: `borrowed`/`collected` are cash in, `repaid`/`lent`
 * are cash out.
 */
export type LoanEntryKind = "borrowed" | "repaid" | "lent" | "collected";

/**
 * Document shape for `cash_entries/{entryId}`.
 * Manual cash inflow/outflow entries for ledger-style adjustments.
 */
export type CashEntryDoc = {
  entry_type: CashEntryType;
  amount: number;
  date: Timestamp;
  note?: string;
  /** Optional link to the party (person/company) this cash came from or went to. */
  party_id?: string;
  /** Denormalized party name captured at entry time for display. */
  party_name?: string;
  /** When set, this entry is a loan movement (requires `party_id`). */
  loan_kind?: LoanEntryKind;
  created_at: Timestamp;
};

/**
 * Document shape for `settings/cash` — cash-on-hand baseline for the dashboard.
 */
export type CashSettingsDoc = {
  opening_balance: number;
  actual_cash_balance?: number;
  actual_cash_updated_at?: Timestamp;
  updated_at: Timestamp;
};

export type CategoryMarginTemplate = {
  target_margin_percent: number;
  pricing_mode: PricingMode;
};

/**
 * Document shape for `settings/pricing` — global default margin and per-category templates.
 */
export type PricingSettingsDoc = {
  global_default_target_margin_percent: number;
  category_templates: Record<string, CategoryMarginTemplate>;
  updated_at: Timestamp;
};

export const PRICING_SETTINGS_DOC_ID = "pricing";
export const DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT = 15;

/**
 * Document shape for `settings/customer_engagement` — tier thresholds and tier discounts.
 */
export type CustomerEngagementSettingsDoc = {
  rolling_window_days: number;
  premium_min_orders: number;
  premium_min_spend: number;
  premium_discount_percent: number;
  silver_min_orders: number;
  silver_min_spend: number;
  silver_max_spend: number;
  silver_discount_percent: number;
  bronze_orders: number;
  bronze_max_spend: number;
  updated_at: Timestamp;
};

export const CUSTOMER_ENGAGEMENT_SETTINGS_DOC_ID = "customer_engagement";

/**
 * Document shape for `customers/{customerId}`.
 */
export type CustomerDoc = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  is_active: boolean;
  archived_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Supplier we buy stock from, for `traders/{traderId}`.
 */
export type TraderDoc = {
  name: string;
  phone?: string;
  address?: string;
  contact_person?: string;
  city?: string;
  notes?: string;
  is_active: boolean;
  archived_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Document shape for `parties/{partyId}`.
 * A party is any person or company tied to a manual cash entry — e.g. the
 * owner, an investor, a lender, or a bank. Kept separate from customers and
 * traders since manual cash movements are independent of sales/purchases.
 */
export type PartyDoc = {
  name: string;
  phone?: string;
  address?: string;
  contact_person?: string;
  city?: string;
  notes?: string;
  is_active: boolean;
  archived_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type InvoiceStatus = "draft" | "posted" | "void";
export type InvoicePaymentStatus = "unpaid" | "partial" | "paid";

/**
 * Document shape for `invoices/{invoiceId}`.
 * `customer_id` references `customers/{customerId}`.
 * `order_id` is an immutable human-readable order identifier.
 */
export type InvoiceDoc = {
  customer_id: string;
  order_id: string;
  status: InvoiceStatus;
  payment_status: InvoicePaymentStatus;
  paid_amount: number;
  stock_reversal_applied: boolean;
  item_ids: string[];
  subtotal_amount: number;
  discount_amount: number;
  delivery_charge: number;
  total_amount: number;
  posted_subtotal_amount?: number;
  posted_discount_amount?: number;
  posted_delivery_charge?: number;
  posted_total_amount?: number;
  posted_cogs_amount?: number;
  /** Cumulative value of posted returns against this invoice. */
  returned_amount?: number;
  /** Posted return document IDs linked to this invoice. */
  return_ids?: string[];
  notes?: string;
  posted_at?: Timestamp;
  voided_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type InvoiceReturnStatus = "draft" | "posted" | "void";
export type InvoiceReturnSettlementType = "reduce_balance" | "cash_refund";

/**
 * Document shape for `invoice_returns/{returnId}`.
 */
export type InvoiceReturnDoc = {
  return_number: string;
  original_invoice_id: string;
  order_id: string;
  customer_id: string;
  status: InvoiceReturnStatus;
  settlement_type: InvoiceReturnSettlementType;
  item_ids: string[];
  subtotal_amount: number;
  total_amount: number;
  refund_amount: number;
  /** Sum of discard FIFO write-off COGS at post (damaged goods). */
  write_off_cogs_amount?: number;
  return_reason?: string;
  notes?: string;
  posted_at?: Timestamp;
  voided_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Document shape for `invoice_return_items/{itemId}`.
 */
export type InvoiceReturnItemDoc = {
  return_id: string;
  original_invoice_id: string;
  original_invoice_item_id: string;
  customer_id: string;
  order_id: string;
  product_id: string;
  quantity_returned: number;
  /** Resellable units restored to stock at post. */
  quantity_restock: number;
  /** Damaged units written off (no stock restore). */
  quantity_discard: number;
  unit_price: number;
  line_discount: number;
  line_delivery_charge: number;
  line_total: number;
  /** FIFO COGS for restock portion (filled at post). */
  cogs_amount: number;
  /** FIFO COGS for discard portion (filled at post). */
  write_off_cogs_amount: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Audit row for stock restored to a lot on return post.
 */
export type ReturnLotRestorationDoc = {
  return_id: string;
  consumption_id: string;
  lot_id: string;
  product_id: string;
  invoice_id: string;
  invoice_item_id: string;
  quantity: number;
  unit_cost: number;
  cogs_amount: number;
  created_at: Timestamp;
};

/**
 * Audit row for damaged/discarded return qty — FIFO cost write-off, no stock restore.
 */
export type ReturnLotWriteOffDoc = {
  return_id: string;
  consumption_id: string;
  lot_id: string;
  product_id: string;
  invoice_id: string;
  invoice_item_id: string;
  quantity: number;
  unit_cost: number;
  cogs_amount: number;
  created_at: Timestamp;
};

/**
 * Document shape for `invoice_items/{invoiceItemId}`.
 * One row per invoice line item; belongs to an invoice and product.
 */
export type InvoiceItemDoc = {
  invoice_id: string;
  order_id: string;
  customer_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_discount: number;
  line_delivery_charge: number;
  line_total: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type StockLotSource = "stock_in" | "opening_balance" | "adjustment";

/**
 * FIFO inventory lot for `stock_lots/{lotId}`.
 */
export type StockLotDoc = {
  product_id: string;
  unit_cost: number;
  qty_in: number;
  qty_remaining: number;
  source: StockLotSource;
  reference_id?: string;
  /** Denormalized trader name at receipt time (from Traders management). */
  purchase_source?: string;
  /** Link to `traders/{traderId}` — required on new stock-in receipts. */
  trader_id?: string;
  received_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Consumption record for `lot_consumptions/{consumptionId}`.
 * One row per (invoice item, lot) consumption segment.
 */
export type LotConsumptionDoc = {
  invoice_id: string;
  order_id: string;
  invoice_item_id: string;
  product_id: string;
  lot_id: string;
  quantity: number;
  unit_cost: number;
  cogs_amount: number;
  created_at: Timestamp;
  reversed_at?: Timestamp;
};

/**
 * Immutable per-invoice-line COGS snapshot (`invoice_item_cogs/{invoice_item_id}`).
 * Written once at posting time; never updated.
 */
export type InvoiceItemCogsDoc = {
  invoice_id: string;
  order_id: string;
  customer_id: string;
  invoice_item_id: string;
  product_id: string;
  quantity: number;
  unit_sale_price: number;
  unit_cost_snapshot: number;
  line_subtotal: number;
  line_discount: number;
  line_delivery_charge: number;
  cogs_amount: number;
  line_total: number;
  created_at: Timestamp;
};

/**
 * Standalone stock discard header (`inventory_discards/{discardId}`).
 * For QC failures and damaged goods — not tied to invoices or returns.
 */
export type InventoryDiscardDoc = {
  discard_number: string;
  reason?: string;
  notes?: string;
  total_quantity: number;
  total_cogs_amount: number;
  item_ids: string[];
  created_at: Timestamp;
};

/**
 * One product line on a stock discard (`inventory_discard_items/{itemId}`).
 */
export type InventoryDiscardItemDoc = {
  discard_id: string;
  product_id: string;
  quantity: number;
  cogs_amount: number;
  created_at: Timestamp;
};

/**
 * FIFO lot audit for discarded stock (`inventory_discard_lots/{docId}`).
 */
export type InventoryDiscardLotDoc = {
  discard_id: string;
  discard_item_id: string;
  lot_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  cogs_amount: number;
  created_at: Timestamp;
};
