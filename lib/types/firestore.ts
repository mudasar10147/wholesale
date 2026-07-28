import type { Timestamp } from "firebase/firestore";

/**
 * Document shape for `products/{productId}`.
 * Field names use snake_case to match docs/PROJECT_SPEC.md.
 */
export type PricingMode = "manual" | "automatic";

/** Inventory ledger outbox status on source documents (invoice, return, discard, product). */
export type LedgerStatus = "pending" | "posted" | "failed" | "not_applicable";

export type LedgerOutboxFields = {
  ledger_status?: LedgerStatus;
  inventory_transaction_id?: string;
  ledger_error?: string;
};

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
  /** Opening-balance ledger (initial stock on product create). */
  opening_ledger_status?: LedgerStatus;
  opening_inventory_transaction_id?: string;
  opening_ledger_error?: string;
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
 * Document shape for `settings/new_arrival` — how long a product counts as newly arrived.
 *
 * "New arrival" means newly *created* (a brand-new SKU), NOT recently restocked. A product
 * is a new arrival while `now - created_at` is within `threshold_days`.
 */
export type NewArrivalSettingsDoc = {
  threshold_days: number;
  updated_at: Timestamp;
};

export const NEW_ARRIVAL_SETTINGS_DOC_ID = "new_arrival";
export const DEFAULT_NEW_ARRIVAL_THRESHOLD_DAYS = 30;

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

/** Outbox state for materializing an invoice's inline return lines after the sale posts. */
export type ReturnsPostStatus = "pending" | "posted";

/**
 * An inline "counter-sale" return captured on an invoice: an item the customer is handing
 * back, resolved to a specific line on one of their past posted invoices. Embedded on the
 * invoice draft; materialized into a real `invoice_returns` doc when the invoice is posted.
 */
export type InvoiceReturnLineEmbedded = {
  original_invoice_id: string;
  original_invoice_item_id: string;
  original_order_id: string;
  product_id: string;
  quantity_returned: number;
  quantity_restock: number;
  quantity_discard: number;
  /** Original unit price the customer paid. */
  unit_price: number;
  /** Proportional credit for this return line, at the original price. */
  line_total: number;
  /**
   * Position among the invoice's combined lines (sale + return/discard), so the order the
   * user built them in survives a reload.
   */
  sort_order?: number;
};

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
  /** Ledger outbox for SALE transaction on post. */
  ledger_status?: LedgerStatus;
  inventory_transaction_id?: string;
  ledger_error?: string;
  /** Ledger outbox for SALE_VOID transaction on void. */
  void_ledger_status?: LedgerStatus;
  void_inventory_transaction_id?: string;
  void_ledger_error?: string;
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
  /** Inline counter-sale returns captured on this invoice (present while a draft). */
  return_lines?: InvoiceReturnLineEmbedded[];
  /** Sum of return line credits, R. */
  returns_credit_amount?: number;
  /** Cash handed back when returns exceed the sale total, max(0, R − sale). */
  cash_refund_amount?: number;
  /** IDs of the invoice_returns materialized from `return_lines` at post. */
  attached_return_ids?: string[];
  /** Outbox: whether the inline returns have been materialized/posted after the sale. */
  returns_post_status?: ReturnsPostStatus;
  notes?: string;
  posted_at?: Timestamp;
  voided_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type InvoiceReturnStatus = "draft" | "posted" | "void";
/**
 * How a return's value is settled.
 * - `reduce_balance` / `cash_refund` settle against the return's OWN original invoice.
 * - `credit_note` records the return for inventory + returnable tracking but does NOT touch
 *   the original invoice's balance; the credit is applied elsewhere (e.g. a counter-sale
 *   invoice that nets the return against a new sale).
 */
export type InvoiceReturnSettlementType = "reduce_balance" | "cash_refund" | "credit_note";

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
  ledger_status?: LedgerStatus;
  inventory_transaction_id?: string;
  ledger_error?: string;
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
  /** The clerk's own discount on this line. */
  line_discount: number;
  line_delivery_charge: number;
  line_total: number;
  /**
   * Discount from a live promotional offer, separate from `line_discount` so the receipt can
   * show the saving. Absent on lines written before offers set prices, and on any line that
   * was not on offer.
   */
  offer_discount?: number;
  /** Title of the offer that priced this line, for the receipt. */
  offer_label?: string;
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
  /** Warehouse/location; defaults to `default` when absent. */
  warehouse_id?: string;
  /** Link to creating inventory transaction line (go-forward). */
  inventory_transaction_id?: string;
  /** Denormalized trader name at receipt time (from Traders management). */
  purchase_source?: string;
  /** Link to `traders/{traderId}` — required on new stock-in receipts. */
  trader_id?: string;
  received_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  /**
   * Physical recount markers (admin re-baseline tool). A lot closed by a physical
   * recount is frozen pre-recount history: qty_remaining is forced to 0 and the lot
   * is excluded from the L6 consumption-chain check (its history is no longer
   * asserted). Never deleted — retained for audit.
   */
  closed_by_recount?: boolean;
  /** Set on the single new baseline lot a recount creates (source: "adjustment"). */
  recount_baseline?: boolean;
  /** Links a closed/baseline lot to the `physical_stock_corrections` record that touched it. */
  recount_correction_id?: string;
  closed_at?: Timestamp;
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
  ledger_status?: LedgerStatus;
  inventory_transaction_id?: string;
  ledger_error?: string;
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

export type WarehouseDoc = {
  code: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  address?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type InventoryTransactionStatus = "draft" | "posted" | "void";

export type InventoryTransactionType =
  | "PURCHASE_RECEIPT"
  | "STOCK_ISSUE"
  | "SALE"
  | "SALE_VOID"
  | "SALES_RETURN"
  | "ADJUSTMENT"
  | "DAMAGE"
  | "OPENING_BALANCE"
  | "TRANSFER"
  // Book/lot correction that changes a stored number without any physical movement.
  // Carries `movement: false` and MUST never enter movement sums (invariants G4/G8).
  // Written only by the M0.5 reconciliation tool (see docs/inventory/BASELINE_REMEDIATION.md).
  | "RECONCILIATION";

/**
 * Header for `inventory_transactions/{transactionId}` — append-only after post.
 */
export type InventoryTransactionDoc = {
  transaction_number: string;
  type: InventoryTransactionType;
  status: InventoryTransactionStatus;
  warehouse_id: string;
  to_warehouse_id?: string;
  source_document_type?: string;
  source_document_id?: string;
  reason?: string;
  notes?: string;
  item_ids: string[];
  /**
   * Whether this transaction represents a physical movement of goods. Absent is
   * treated as `true` (all legacy rows moved stock). `RECONCILIATION` rows set it
   * to `false` — they correct a stored number, nothing physically moved. Invariant
   * G4 sums movement and reconciliation lines separately; G8 keeps `false` rows out
   * of movement sums.
   */
  movement?: boolean;
  posted_at?: Timestamp;
  posted_by_uid?: string;
  voided_at?: Timestamp;
  voided_by_uid?: string;
  reverses_transaction_id?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type InventoryTransactionLineDoc = {
  transaction_id: string;
  product_id: string;
  warehouse_id: string;
  direction: "in" | "out";
  quantity: number;
  unit_cost: number;
  total_cost: number;
  lot_id?: string;
  before_on_hand?: number;
  after_on_hand?: number;
  created_at: Timestamp;
};

/**
 * One lot's correction inside a `RECONCILIATION` ledger row. Every value is
 * derived from append-only history (M0.5 §19.0.5-M.3), never chosen, so the
 * repair is reconstructable without the tool.
 */
export type ReconciliationLotCorrection = {
  lot_id: string;
  qty_in: number;
  before: number;
  after: number;
  delta: number;
  history_implied: number;
};

/**
 * A `RECONCILIATION` row in `inventory_transactions`. Superset of the standard
 * header (so type/movement-aware ledger checks keep working) plus the per-lot
 * corrections and book before/after. `movement` is always `false`.
 * Temporary — written by the M0.5 tool, absorbed by M6's audited workflow.
 */
export type ReconciliationLedgerDoc = InventoryTransactionDoc & {
  type: "RECONCILIATION";
  movement: false;
  product_id: string;
  book_before: number;
  book_after: number;
  lot_total_before: number;
  lot_total_after: number;
  lot_corrections: ReconciliationLotCorrection[];
  validation_run_id: string;
  authority_category: InventoryRepairAuthority;
  reason_detail: string;
  approved_by_uid?: string;
};

export type InventoryRepairAuthority =
  | "physical_count"
  | "purchase_receipt"
  | "invoice_history"
  | "consumption_history"
  | "return_history"
  | "discard_history"
  | "administrative";

/**
 * Immutable audit record for one product's repair, in `inventory_repairs/{repairId}`.
 * The M0.5 emergency tool and M6's audited workflow write the SAME schema so the
 * baseline repairs stay first-class history across the transition (§15.3, §19.0.5-M.8).
 * A repair with no `ledger_transaction_id` is not a repair.
 */
export type InventoryRepairDoc = {
  validation_run_id: string;
  product_id: string;
  invariant_id: string;
  before_book_stock: number;
  before_lot_total: number;
  physical_count?: number;
  approved_final_quantity: number;
  adjustment_delta: number;
  authority_category: InventoryRepairAuthority;
  reason_detail: string;
  related_document_ids: string[];
  acted_by_uid: string;
  approved_by_uid?: string;
  created_at: Timestamp;
  ledger_transaction_id: string;
  /** The physical-movement ledger row, when a verified count differed from history. */
  physical_adjustment_transaction_id?: string;
};

/** Source of the unit cost applied to a physical-recount baseline lot. */
export type PhysicalCorrectionCostSource = "latest_stock_in" | "product_cost_price" | "manual";

/** One closed pre-recount lot captured on a correction record. */
export type PhysicalCorrectionClosedLot = {
  lot_id: string;
  qty_remaining_before: number;
};

/** Post-update self-verification result stored on every correction. */
export type PhysicalCorrectionValidation = {
  ok: boolean;
  stock_equals_count: boolean;
  lot_total_equals_count: boolean;
  open_lot_count_ok: boolean;
};

/**
 * Immutable audit record for one physical stock correction, in
 * `physical_stock_corrections/{correctionId}`. The physically-counted quantity is
 * authoritative; nothing here is reconstructed from history. Append-only: an undo is
 * a new correction, never a deletion. `correction_id` == the doc id == the caller's
 * idempotency key, so a replayed submission collides on `.create()`.
 */
export type PhysicalStockCorrectionDoc = {
  correction_id: string;
  /** Batch/session grouping many single-product corrections. */
  recount_session_id: string;
  product_id: string;
  product_name: string;
  /** The product document id doubles as the SKU key. */
  sku: string;
  /** No barcode field exists on products yet; always null for now. */
  barcode: string | null;
  before_book_stock: number;
  before_lot_total: number;
  physical_count: number;
  stock_delta: number;
  /** Every open lot this correction zeroed/closed, with its pre-close remaining. */
  closed_lots: PhysicalCorrectionClosedLot[];
  /** The one new baseline lot; null when physical_count is 0. */
  new_lot_id: string | null;
  unit_cost: number;
  cost_source: PhysicalCorrectionCostSource;
  /** The ADJUSTMENT ledger row recording the physical surplus/shrinkage. */
  ledger_transaction_id: string;
  operator_uid: string;
  operator_email: string;
  reason: string;
  created_at: Timestamp;
  post_update_validation: PhysicalCorrectionValidation;
};

export type SchemaMigrationDoc = {
  version: string;
  applied_at: Timestamp;
  applied_by?: string;
  backup_path?: string;
  records_affected: number;
  rollback_instructions: string;
};

export type InventoryShadowDiffDoc = {
  context: string;
  product_id?: string;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  created_at: Timestamp;
};

/* ── Social media planner ─────────────────────────────────────────────────── */

/**
 * Where a post's products came from — hand-picked, or the suggestion lens that seeded them.
 * Recorded for the badge on the post card; `custom` means the post carries no products.
 */
export type SocialPostKind =
  | "products"
  | "random"
  | "best_sellers"
  | "aging_stock"
  | "new_arrivals"
  | "offer"
  | "custom";

/**
 * The medium a post is sent in. Paired with `kind` it yields the post's type — see
 * `postTypeOf` in `lib/social/postTypes`, which is what the UI actually works in.
 *
 * `image` and `video` are legacy: they meant "media with no message", and no new post is
 * written with them. They are read as their `_text` counterparts.
 */
export type SocialPostFormat = "text" | "image" | "image_text" | "video" | "video_text";

export type SocialPostStatus = "draft" | "ready" | "posted" | "skipped";

/** A pasted video/image link (Drive, YouTube, phone upload). Not a stored file. */
export type SocialMediaLink = {
  url: string;
  label?: string;
};

export type SocialPostDoc = {
  /** ISO week key, e.g. `2026-W29`. Equality-filtered — needs no composite index. */
  week_key: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  scheduled_date: string;
  /** 24h local time, `HH:mm`. */
  scheduled_time: string;
  kind: SocialPostKind;
  /** Absent on posts written before formats existed; those are read as `image_text`. */
  format?: SocialPostFormat;
  status: SocialPostStatus;
  caption: string;
  product_ids: string[];
  offer_id?: string;
  media_links: SocialMediaLink[];
  note?: string;
  posted_at?: Timestamp;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Where a week sits in the approval loop. The social manager builds the week, submits it,
 * and an admin approves it before anything goes out.
 *
 * `revising` is an approved week the manager has pulled back to change: it is editable
 * again, it can no longer be posted, and it has to be re-approved before it can be.
 */
export type SocialWeekPlanStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "changes_requested"
  | "revising";

/** Doc id is the ISO week key. A week with no doc has never been submitted — it is a draft. */
export type SocialWeekPlanDoc = {
  week_key: string;
  status: SocialWeekPlanStatus;
  submitted_by?: string;
  submitted_at?: Timestamp;
  reviewed_by?: string;
  reviewed_at?: Timestamp;
  /** The admin's reason, set when they send a week back for changes. */
  review_note?: string;
  updated_at: Timestamp;
};

export type SocialOfferDiscountType = "percent" | "flat" | "none";

export type SocialOfferDoc = {
  title: string;
  description?: string;
  discount_type: SocialOfferDiscountType;
  /** Percent (0–100) or flat currency amount. Ignored when discount_type is "none". */
  discount_value: number;
  /**
   * In a normal offer, the products it covers. In a sitewide offer, the products it EXCLUDES.
   * Capped at 100 by the rules either way.
   */
  product_ids: string[];
  /**
   * Sitewide sale: every product except those listed above. Absent on offers authored before
   * this field existed — treat undefined as false everywhere.
   */
  applies_to_all?: boolean;
  /** Sitewide sales skip new arrivals unless this is set. Ignored by normal offers. */
  includes_new_arrivals?: boolean;
  /** `YYYY-MM-DD`. */
  starts_on: string;
  ends_on: string;
  is_active: boolean;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Doc id is the ISO week key. */
export type SocialNoteDoc = {
  week_key: string;
  body: string;
  updated_by: string;
  updated_at: Timestamp;
};

/** How every composed caption is worded. Set from the Firestore console; read on every page. */
export type SocialMediaSettingsDoc = {
  /** Trailing call-to-action appended to every caption. */
  footer_line: string;
  currency_prefix: string;
  updated_at: Timestamp;
};

export const SOCIAL_MEDIA_SETTINGS_DOC_ID = "social_media";
