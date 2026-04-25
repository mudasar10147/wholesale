import { deleteField, doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";

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
