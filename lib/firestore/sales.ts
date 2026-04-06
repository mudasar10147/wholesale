import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProductDoc } from "@/lib/types/firestore";

/**
 * Record a sale and decrement product stock in one transaction.
 * Uses the product's current `sale_price` for the sale line.
 */
export async function recordSale(
  db: Firestore,
  params: { productId: string; quantity: number },
): Promise<void> {
  const { productId, quantity } = params;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }

  const productRef = doc(db, COLLECTIONS.products, productId);
  const saleRef = doc(collection(db, COLLECTIONS.sales));

  await runTransaction(db, async (transaction) => {
    const productSnap = await transaction.get(productRef);
    if (!productSnap.exists) {
      throw new Error("Product not found.");
    }
    const data = productSnap.data() as ProductDoc | undefined;
    if (!data) {
      throw new Error("Product not found.");
    }

    const stock =
      typeof data.stock_quantity === "number" ? data.stock_quantity : 0;
    if (stock < quantity) {
      throw new Error("Not enough stock for this sale.");
    }

    const salePrice = typeof data.sale_price === "number" ? data.sale_price : 0;
    const totalAmount = salePrice * quantity;

    transaction.set(saleRef, {
      product_id: productId,
      quantity,
      sale_price: salePrice,
      total_amount: totalAmount,
      date: serverTimestamp(),
    });

    transaction.update(productRef, {
      stock_quantity: increment(-quantity),
    });
  });
}
