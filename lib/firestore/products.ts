import {
  collection,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { inheritPricingFieldsForNewProduct } from "@/lib/pricing/automaticPricing";
import { automaticSalePrice } from "@/lib/pricing/metrics";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { applyStockInInTransaction } from "@/lib/firestore/inventory";
import { loadPricingSettings } from "@/lib/firestore/pricingSettings";
import type { PricingMode, ProductDoc } from "@/lib/types/firestore";

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
  target_margin_percent?: number;
  pricing_mode?: PricingMode;
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

  const settings = await loadPricingSettings(db);
  const cat = input.category?.trim();
  const inherited = inheritPricingFieldsForNewProduct(
    cat,
    settings.categoryTemplates,
    settings.globalDefaultTargetMarginPercent,
    input.cost_price,
  );

  const pricing_mode = input.pricing_mode ?? inherited.pricing_mode;
  const target_margin_percent =
    input.target_margin_percent ?? inherited.target_margin_percent ?? settings.globalDefaultTargetMarginPercent;
  let sale_price = input.sale_price;
  if (pricing_mode === "automatic") {
    sale_price = automaticSalePrice(input.cost_price, target_margin_percent);
  }

  const productRef = doc(collection(db, COLLECTIONS.products));

  await runTransaction(db, async (tx) => {
    const payload: Record<string, unknown> = {
      name,
      cost_price: input.cost_price,
      sale_price,
      stock_quantity: 0,
      target_margin_percent,
      pricing_mode,
      pricing_updated_at: serverTimestamp(),
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
        pricing_mode,
        target_margin_percent,
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
        pricing_mode === "manual" ? sale_price : undefined,
        {
          categoryTemplates: settings.categoryTemplates,
          globalDefault: settings.globalDefaultTargetMarginPercent,
        },
      );
    }
  });

  return productRef.id;
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
