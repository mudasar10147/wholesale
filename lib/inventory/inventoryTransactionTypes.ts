export type InventoryTransactionType =
  | "PURCHASE_RECEIPT"
  | "STOCK_ISSUE"
  | "SALE"
  | "SALE_VOID"
  | "SALES_RETURN"
  | "ADJUSTMENT"
  | "DAMAGE"
  | "OPENING_BALANCE"
  | "TRANSFER";

export type InventoryTransactionStatus = "draft" | "posted" | "void";

export type InventoryTransactionDirection = "in" | "out";

export type InventoryTransactionLineInput = {
  product_id: string;
  warehouse_id: string;
  direction: InventoryTransactionDirection;
  quantity: number;
  unit_cost: number;
  lot_id?: string;
  before_on_hand?: number;
  after_on_hand?: number;
};

export type RecordInventoryTransactionInput = {
  type: InventoryTransactionType;
  warehouse_id: string;
  source_document_type?: string;
  source_document_id?: string;
  reason?: string;
  notes?: string;
  posted_by_uid?: string;
  lines: InventoryTransactionLineInput[];
};
