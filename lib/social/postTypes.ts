import type {
  SocialPostDoc,
  SocialPostFormat,
  SocialPostKind,
  SocialPostStatus,
} from "@/lib/types/firestore";
import type { SuggestionSource } from "@/lib/social/types";

/**
 * What the social manager actually picks when they create a post. One choice, not two.
 *
 * Underneath it still writes `format` (the medium) and `kind` (where the products came
 * from), because that is what the documents have always carried — but nothing in the UI
 * asks for those separately any more, so the combinations that made no sense (an offer
 * post with no offer; a photo post that silently drops its offer) cannot be built.
 */
export type SocialPostType = "product" | "offer" | "video" | "message";

export const POST_TYPES: readonly SocialPostType[] = ["product", "offer", "video", "message"];

/** Which parts of the editor a type uses. The same flags gate the saved payload. */
export type PostSections = {
  /** Products to photograph and price. */
  products: boolean;
  /** The discount campaign this post advertises. */
  offer: boolean;
  /** Pasted video/image links. */
  media: boolean;
  /** The written WhatsApp message. */
  message: boolean;
};

export type PostTypeSpec = {
  type: SocialPostType;
  label: string;
  /** Shown under the label in the type picker — says what this post *is*, in the manager's words. */
  hint: string;
  icon: string;
  format: SocialPostFormat;
  defaultKind: SocialPostKind;
  sections: PostSections;
  /**
   * The post's `kind` records where its products came from, so adding them from a
   * Suggestions tab re-labels the post. False when the kind is fixed by the type itself.
   */
  sourcedKind: boolean;
};

export const POST_TYPE_SPECS: Record<SocialPostType, PostTypeSpec> = {
  product: {
    type: "product",
    label: "Product post",
    hint: "A photo with the price list under it. You pick the products to share.",
    icon: "🖼️",
    format: "image_text",
    defaultKind: "products",
    sections: { products: true, offer: false, media: true, message: true },
    sourcedKind: true,
  },
  offer: {
    type: "offer",
    label: "Offer post",
    hint: "Advertise a discount you set up in Offers. Its products come along with it.",
    icon: "🏷️",
    format: "image_text",
    defaultKind: "offer",
    sections: { products: true, offer: true, media: true, message: true },
    sourcedKind: false,
  },
  video: {
    type: "video",
    label: "Video post",
    hint: "A video link — a reel, a Drive clip — with a message to send alongside it.",
    icon: "🎬",
    format: "video_text",
    defaultKind: "custom",
    sections: { products: true, offer: false, media: true, message: true },
    sourcedKind: true,
  },
  message: {
    type: "message",
    label: "Message only",
    hint: "Plain text. No products, no photo — an announcement, a greeting, a holiday notice.",
    icon: "💬",
    format: "text",
    defaultKind: "custom",
    sections: { products: false, offer: false, media: false, message: true },
    sourcedKind: false,
  },
};

export function specOf(type: SocialPostType): PostTypeSpec {
  return POST_TYPE_SPECS[type];
}

/**
 * Read any stored post back as a type — including ones written before types existed.
 *
 * The medium decides first, so this is total: `image`/`video` were the old "media with no
 * message" formats and map onto their `_text` counterparts, whose caption box simply opens
 * empty. Nothing needs migrating; saving such a post normalizes its format on the way out.
 */
export function postTypeOf(post: Pick<SocialPostDoc, "kind" | "format">): SocialPostType {
  switch (normalizePostFormat(post.format)) {
    case "text":
      return "message";
    case "video":
    case "video_text":
      return "video";
    case "image":
    case "image_text":
      return post.kind === "offer" ? "offer" : "product";
  }
}

/** Every format a stored post may carry, including the two legacy ones. */
export const POST_FORMATS: readonly SocialPostFormat[] = [
  "text",
  "image",
  "image_text",
  "video",
  "video_text",
];

/** Posts written before formats existed carried a photo and a caption. */
export function normalizePostFormat(value: unknown): SocialPostFormat {
  return POST_FORMATS.includes(value as SocialPostFormat)
    ? (value as SocialPostFormat)
    : "image_text";
}

export type PostContentCounts = {
  products: number;
  mediaLinks: number;
  captionLength: number;
  hasOffer: boolean;
};

/**
 * The one thing still missing before this post can be sent, or null when it is ready.
 * Written as a sentence because it is shown to the manager verbatim, and it is what
 * disables Save.
 */
export function describePostGap(
  type: SocialPostType,
  counts: PostContentCounts,
): string | null {
  const noMessage = "Write the message, or press Regenerate to build it from the products.";

  switch (type) {
    case "product":
      if (counts.products === 0) return "Add at least one product to share.";
      return counts.captionLength > 0 ? null : noMessage;
    case "offer":
      if (!counts.hasOffer) return "Pick the offer this post is advertising.";
      return counts.captionLength > 0 ? null : noMessage;
    case "video":
      // The message is optional here — the video is the post.
      return counts.mediaLinks > 0 ? null : "Paste the video link before saving.";
    case "message":
      return counts.captionLength > 0 ? null : "Write the message before saving.";
  }
}

/** Section heading for the media list — a video post wants one link, a product post wants many. */
export const MEDIA_SECTION_LABELS: Record<SocialPostType, string> = {
  product: "Photo / video links (optional)",
  offer: "Photo / video links (optional)",
  video: "Video link",
  message: "Links",
};

/** Where a post's products came from. Shown as a badge next to the type. */
export const POST_KIND_LABELS: Record<SocialPostKind, string> = {
  products: "Hand-picked",
  random: "Random",
  best_sellers: "Best sellers",
  aging_stock: "Dead & aging",
  new_arrivals: "New arrivals",
  offer: "Offer",
  custom: "Custom",
};

/** Adding products from a Suggestions tab re-labels the post with where they came from. */
export const KIND_BY_SUGGESTION_SOURCE: Record<SuggestionSource, SocialPostKind> = {
  random: "random",
  best_sellers: "best_sellers",
  aging_stock: "aging_stock",
  new_arrivals: "new_arrivals",
  // No kind of its own — an overstock pick is still the manager choosing from a list.
  overstock: "products",
};

export const POST_STATUSES: readonly SocialPostStatus[] = ["draft", "ready", "posted", "skipped"];

export const POST_STATUS_LABELS: Record<SocialPostStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  posted: "Posted",
  skipped: "Skipped",
};
