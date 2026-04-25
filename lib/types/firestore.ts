import type { Timestamp } from "firebase/firestore";

/**
 * Document shape for `products/{productId}`.
 * Field names use snake_case to match docs/PROJECT_SPEC.md.
 */
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
  created_at: Timestamp;
};

/**
 * Document shape for `sales/{saleId}`.
 * `product_id` references `products/{product_id}`.
 */
export type SaleDoc = {
  invoice_id?: string;
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

export type PartnerLoanEntryType = "loan_in" | "repayment" | "loan_given" | "loan_given_return";

/**
 * Document shape for `partner_loans/{loanId}`.
 * Tracks money borrowed from partners and repayments back to them.
 */
export type PartnerLoanDoc = {
  partner_name: string;
  entry_type: PartnerLoanEntryType;
  amount: number;
  date: Timestamp;
  note?: string;
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
  notes?: string;
  posted_at?: Timestamp;
  voided_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
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
