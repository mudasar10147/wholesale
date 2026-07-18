import type { InventoryTransactionType } from "@/lib/inventory/inventoryTransactionTypes";

export type InventoryPostedEventLine = {
  product_id: string;
  warehouse_id: string;
  direction: "in" | "out";
  quantity: number;
  unit_cost: number;
  total_cost: number;
  lot_id?: string;
  before_on_hand?: number;
  after_on_hand?: number;
};

/** Emitted after a successful inventory transaction post. Accounting module may subscribe. */
export type InventoryPostedEvent = {
  transaction_id: string;
  transaction_number: string;
  type: InventoryTransactionType;
  warehouse_id: string;
  source_document_type?: string;
  source_document_id?: string;
  posted_at: string;
  posted_by_uid?: string;
  lines: InventoryPostedEventLine[];
};
