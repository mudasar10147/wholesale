import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { POST_FORMATS } from "@/lib/social/postTypes";
import type {
  SocialMediaLink,
  SocialPostDoc,
  SocialPostFormat,
  SocialPostKind,
  SocialPostStatus,
} from "@/lib/types/firestore";

export type SocialPostRow = SocialPostDoc & { id: string };

const MAX_PRODUCTS_PER_POST = 50;
const MAX_MEDIA_LINKS = 10;
const MAX_CAPTION_LENGTH = 4096;

export type SocialPostInput = {
  weekKey: string;
  scheduledDate: string;
  scheduledTime: string;
  kind: SocialPostKind;
  format: SocialPostFormat;
  status: SocialPostStatus;
  caption: string;
  productIds: string[];
  offerId?: string;
  mediaLinks: SocialMediaLink[];
  note?: string;
};

function normalizeMediaLinks(links: SocialMediaLink[]): SocialMediaLink[] {
  return links
    .map((link) => ({ url: link.url.trim(), label: link.label?.trim() }))
    .filter((link) => link.url.length > 0)
    .map((link) => (link.label ? { url: link.url, label: link.label } : { url: link.url }));
}

/** Rejects anything that is not an http(s) URL — a bare "drive.google.com/…" paste is a broken link. */
export function isValidMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function assertValidInput(input: SocialPostInput): void {
  if (!input.weekKey.trim()) {
    throw new Error("Week is required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) {
    throw new Error("Pick a valid date.");
  }
  if (!/^\d{2}:\d{2}$/.test(input.scheduledTime)) {
    throw new Error("Pick a valid time.");
  }
  if (!POST_FORMATS.includes(input.format)) {
    throw new Error("Pick a valid post format.");
  }
  if (input.caption.length > MAX_CAPTION_LENGTH) {
    throw new Error("Caption is too long.");
  }
  if (input.productIds.length > MAX_PRODUCTS_PER_POST) {
    throw new Error(`A post can hold at most ${MAX_PRODUCTS_PER_POST} products.`);
  }
  if (input.mediaLinks.length > MAX_MEDIA_LINKS) {
    throw new Error(`A post can hold at most ${MAX_MEDIA_LINKS} media links.`);
  }
  const badLink = input.mediaLinks.find((link) => !isValidMediaUrl(link.url));
  if (badLink) {
    throw new Error("Media links must start with http:// or https://.");
  }
}

/**
 * All posts in one ISO week. Single equality filter — served by the automatic index,
 * so no composite index is required. Ordering is done by the caller.
 */
export async function fetchSocialPostsForWeek(
  db: Firestore,
  weekKey: string,
): Promise<SocialPostRow[]> {
  const q = query(collection(db, COLLECTIONS.socialPosts), where("week_key", "==", weekKey));
  const snap = await getDocs(q);
  const rows: SocialPostRow[] = [];
  snap.forEach((docSnap) => {
    rows.push({ id: docSnap.id, ...(docSnap.data() as SocialPostDoc) });
  });
  return rows;
}

/** Posts across several weeks — used to warn when a product was shared too recently. */
export async function fetchSocialPostsForWeeks(
  db: Firestore,
  weekKeys: string[],
): Promise<SocialPostRow[]> {
  const unique = [...new Set(weekKeys.filter((key) => key.trim().length > 0))];
  const results = await Promise.all(unique.map((key) => fetchSocialPostsForWeek(db, key)));
  return results.flat();
}

export async function createSocialPost(
  db: Firestore,
  input: SocialPostInput,
  createdBy: string,
): Promise<string> {
  assertValidInput(input);
  const ref = await addDoc(collection(db, COLLECTIONS.socialPosts), {
    week_key: input.weekKey,
    scheduled_date: input.scheduledDate,
    scheduled_time: input.scheduledTime,
    kind: input.kind,
    format: input.format,
    status: input.status,
    caption: input.caption,
    product_ids: input.productIds,
    ...(input.offerId ? { offer_id: input.offerId } : {}),
    media_links: normalizeMediaLinks(input.mediaLinks),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    created_by: createdBy,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSocialPost(
  db: Firestore,
  postId: string,
  input: SocialPostInput,
): Promise<void> {
  assertValidInput(input);
  const note = input.note?.trim();
  await updateDoc(doc(db, COLLECTIONS.socialPosts, postId), {
    week_key: input.weekKey,
    scheduled_date: input.scheduledDate,
    scheduled_time: input.scheduledTime,
    kind: input.kind,
    format: input.format,
    status: input.status,
    caption: input.caption,
    product_ids: input.productIds,
    offer_id: input.offerId ? input.offerId : deleteField(),
    media_links: normalizeMediaLinks(input.mediaLinks),
    note: note ? note : deleteField(),
    updated_at: serverTimestamp(),
  });
}

export async function setSocialPostStatus(
  db: Firestore,
  postId: string,
  status: SocialPostStatus,
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.socialPosts, postId), {
    status,
    // Clearing "posted" must also clear the timestamp, or the outcome window lies.
    posted_at: status === "posted" ? serverTimestamp() : deleteField(),
    updated_at: serverTimestamp(),
  });
}

export async function deleteSocialPost(db: Firestore, postId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.socialPosts, postId));
}
