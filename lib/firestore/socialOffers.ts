import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { SocialOfferDiscountType, SocialOfferDoc } from "@/lib/types/firestore";

export type SocialOfferRow = SocialOfferDoc & { id: string };

export type SocialOfferInput = {
  title: string;
  description?: string;
  discountType: SocialOfferDiscountType;
  discountValue: number;
  /** Covered products, or excluded ones when `appliesToAll` is set. */
  productIds: string[];
  appliesToAll: boolean;
  includesNewArrivals: boolean;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
};

function assertValidInput(input: SocialOfferInput): void {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Title is required.");
  }
  if (title.length > 200) {
    throw new Error("Title is too long.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn)) {
    throw new Error("Pick a valid start and end date.");
  }
  if (input.endsOn < input.startsOn) {
    throw new Error("End date cannot be before the start date.");
  }
  if (!Number.isFinite(input.discountValue) || input.discountValue < 0) {
    throw new Error("Discount cannot be negative.");
  }
  if (input.discountType === "percent" && input.discountValue > 100) {
    throw new Error("A percentage discount cannot exceed 100.");
  }
  if (input.productIds.length > 100) {
    throw new Error(
      input.appliesToAll
        ? "An offer can exclude at most 100 products."
        : "An offer can hold at most 100 products.",
    );
  }
}

export async function fetchSocialOffers(db: Firestore): Promise<SocialOfferRow[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.socialOffers));
  const rows: SocialOfferRow[] = [];
  snap.forEach((docSnap) => {
    rows.push({ id: docSnap.id, ...(docSnap.data() as SocialOfferDoc) });
  });
  rows.sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  return rows;
}

/**
 * Re-exported from the pure pricing module, which is where it belongs now that offers set
 * prices: this file has value imports from `firebase/firestore`, and a `--experimental-strip-types`
 * test of the pricer must not drag the whole SDK in behind it.
 */
export { isOfferLive } from "@/lib/pricing/offerPricing";

export async function createSocialOffer(
  db: Firestore,
  input: SocialOfferInput,
  createdBy: string,
): Promise<string> {
  assertValidInput(input);
  const description = input.description?.trim();
  const ref = await addDoc(collection(db, COLLECTIONS.socialOffers), {
    title: input.title.trim(),
    ...(description ? { description } : {}),
    discount_type: input.discountType,
    discount_value: input.discountType === "none" ? 0 : input.discountValue,
    product_ids: input.productIds,
    applies_to_all: input.appliesToAll,
    includes_new_arrivals: input.includesNewArrivals,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    is_active: input.isActive,
    created_by: createdBy,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSocialOffer(
  db: Firestore,
  offerId: string,
  input: SocialOfferInput,
): Promise<void> {
  assertValidInput(input);
  const description = input.description?.trim();
  await updateDoc(doc(db, COLLECTIONS.socialOffers, offerId), {
    title: input.title.trim(),
    description: description ? description : deleteField(),
    discount_type: input.discountType,
    discount_value: input.discountType === "none" ? 0 : input.discountValue,
    // Written whole either way: the curated list survives a sitewide toggle, so unticking
    // brings it back instead of silently losing what someone picked.
    product_ids: input.productIds,
    applies_to_all: input.appliesToAll,
    includes_new_arrivals: input.includesNewArrivals,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    is_active: input.isActive,
    updated_at: serverTimestamp(),
  });
}

export async function deleteSocialOffer(db: Firestore, offerId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.socialOffers, offerId));
}
