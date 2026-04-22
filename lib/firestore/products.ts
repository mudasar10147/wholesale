import { deleteField, doc, updateDoc, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";

/**
 * Update display fields only. Does not touch prices or stock.
 */
export async function updateProductDetails(
  db: Firestore,
  productId: string,
  input: { name: string; category: string; imageUrl: string },
): Promise<void> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  const cat = input.category.trim();
  const imageUrl = input.imageUrl.trim();
  const payload: Record<string, unknown> = { name };
  if (cat) {
    payload.category = cat;
  } else {
    payload.category = deleteField();
  }
  if (imageUrl) {
    payload.image_url = imageUrl;
  } else {
    payload.image_url = deleteField();
  }
  await updateDoc(doc(db, COLLECTIONS.products, productId), payload);
}
