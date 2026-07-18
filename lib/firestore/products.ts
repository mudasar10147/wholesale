import {
  collection,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { getAuthClient } from "@/lib/firebase";
import { applyStockInInTransaction, loadTraderNameForStockIn } from "@/lib/firestore/inventory";
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory/constants";
import { fulfillLedgerOutbox, type LedgerSourceBinding } from "@/lib/inventory/ledgerOutbox";
import type { ProductDoc } from "@/lib/types/firestore";

type ProductImageMeta = {
  path: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
};

type ProductImageInput =
  | { action: "keep" }
  | { action: "remove" }
  | { action: "replace"; file: ProductImageMeta };

export type CreateProductInput = {
  name: string;
  category?: string;
  cost_price: number;
  sale_price: number;
  /** Units bought on create; 0 = catalog SKU only (no stock lot or cash purchase). */
  initial_quantity: number;
  /** Required when initial_quantity > 0 — trader from Traders management. */
  trader_id?: string;
  image?: {
    url: string;
    path: string;
    mimeType: string;
    size: number;
  };
};

/**
 * Create a product. Initial quantity is recorded as a stock-in purchase (FIFO lot + cash impact).
 */
export async function createProduct(db: Firestore, input: CreateProductInput): Promise<string> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  if (
    !Number.isInteger(input.initial_quantity) ||
    input.initial_quantity < 0
  ) {
    throw new Error("Initial quantity must be a whole number zero or greater.");
  }
  if (
    typeof input.cost_price !== "number" ||
    !Number.isFinite(input.cost_price) ||
    input.cost_price < 0
  ) {
    throw new Error("Cost price must be zero or greater.");
  }
  if (
    typeof input.sale_price !== "number" ||
    !Number.isFinite(input.sale_price) ||
    input.sale_price < 0
  ) {
    throw new Error("Sale price must be zero or greater.");
  }
  if (input.initial_quantity > 0) {
    const traderId = input.trader_id?.trim() ?? "";
    if (!traderId) {
      throw new Error("Trader is required when adding initial stock.");
    }
  }

  const traderName =
    input.initial_quantity > 0
      ? await loadTraderNameForStockIn(db, input.trader_id!.trim())
      : "";

  const cat = input.category?.trim();
  const sale_price = input.sale_price;

  const productRef = doc(collection(db, COLLECTIONS.products));
  const productId = productRef.id;
  const uid = getAuthClient().currentUser?.uid;

  await runTransaction(db, async (tx) => {
    const payload: Record<string, unknown> = {
      name,
      cost_price: input.cost_price,
      sale_price,
      stock_quantity: 0,
      created_at: serverTimestamp(),
    };
    if (cat) {
      payload.category = cat;
    }
    if (input.image) {
      payload.image_url = input.image.url;
      payload.image_path = input.image.path;
      payload.image_mime = input.image.mimeType;
      payload.image_size = input.image.size;
      payload.image_updated_at = serverTimestamp();
    }
    tx.set(productRef, payload);

    if (input.initial_quantity > 0) {
      const seedProduct = {
        cost_price: input.cost_price,
        sale_price,
        category: cat,
      } as ProductDoc;
      applyStockInInTransaction(
        tx,
        db,
        productRef.id,
        productRef,
        seedProduct,
        input.initial_quantity,
        input.cost_price,
        sale_price,
        input.trader_id!.trim(),
        traderName,
      );
    }
  });

  if (input.initial_quantity > 0) {
    const binding: LedgerSourceBinding = {
      collection: COLLECTIONS.products,
      docId: productId,
      statusField: "opening_ledger_status",
      transactionIdField: "opening_inventory_transaction_id",
      errorField: "opening_ledger_error",
    };
    await fulfillLedgerOutbox(
      db,
      {
        type: "OPENING_BALANCE",
        warehouse_id: DEFAULT_WAREHOUSE_ID,
        source_document_type: "product_create",
        source_document_id: productId,
        posted_by_uid: uid,
        lines: [
          {
            product_id: productId,
            warehouse_id: DEFAULT_WAREHOUSE_ID,
            direction: "in",
            quantity: input.initial_quantity,
            unit_cost: input.cost_price,
          },
        ],
      },
      binding,
      { stockCommitted: true },
    );
  }

  return productId;
}

/**
 * Update display fields only. Does not touch prices or stock.
 */
export async function updateProductDetails(
  db: Firestore,
  productId: string,
  input: {
    name: string;
    category: string;
    image: ProductImageInput;
  },
): Promise<void> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  const cat = input.category.trim();
  const payload: Record<string, unknown> = { name };
  if (cat) {
    payload.category = cat;
  } else {
    payload.category = deleteField();
  }

  if (input.image.action === "remove") {
    payload.image_url = deleteField();
    payload.image_path = deleteField();
    payload.image_mime = deleteField();
    payload.image_size = deleteField();
    payload.image_updated_at = deleteField();
  } else if (input.image.action === "replace") {
    payload.image_url = input.image.file.previewUrl ?? deleteField();
    payload.image_path = input.image.file.path;
    payload.image_mime = input.image.file.mimeType;
    payload.image_size = input.image.file.size;
    payload.image_updated_at = serverTimestamp();
  }
  await updateDoc(doc(db, COLLECTIONS.products, productId), payload);
}

/**
 * Set a product's sale price manually. Cost price is not editable here — it is derived from
 * stock receipts (FIFO lots).
 */
export async function updateProductSalePrice(
  db: Firestore,
  productId: string,
  salePrice: number,
): Promise<void> {
  if (typeof salePrice !== "number" || !Number.isFinite(salePrice) || salePrice < 0) {
    throw new Error("Sale price must be zero or greater.");
  }
  await updateDoc(doc(db, COLLECTIONS.products, productId), { sale_price: salePrice });
}
