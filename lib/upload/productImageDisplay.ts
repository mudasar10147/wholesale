const DUMMY_IMAGE_PATH = "/wholesale_logo.png";

/** Shown when a product has no photo at all, or its stored one fails to load. */
export const PRODUCT_IMAGE_PLACEHOLDER = DUMMY_IMAGE_PATH;

export function publicProductImageApiUrl(imagePath: string): string {
  return `/api/products/image/public?path=${encodeURIComponent(imagePath.trim())}`;
}

/**
 * Width used when copying a photo to share.
 *
 * WhatsApp re-encodes anything you paste down to roughly 1600px, so handing it a larger
 * image just moves bytes that get thrown away. Requesting exactly this width keeps the
 * download small on shop wifi without WhatsApp receiving any less than it would have.
 */
export const SHARE_IMAGE_WIDTH = 1600;

/** Must be one of `images.qualities` in next.config.ts. */
const SHARE_IMAGE_QUALITY = 75;

/**
 * URL of a resized copy produced and cached by Next's image optimiser.
 * `width` must appear in `images.deviceSizes` or `images.imageSizes`.
 */
export function optimizedProductImageUrl(
  imagePath: string,
  width: number,
  quality: number = SHARE_IMAGE_QUALITY,
): string {
  const src = publicProductImageApiUrl(imagePath);
  return "/_next/image?url=" + encodeURIComponent(src) + "&w=" + width + "&q=" + quality;
}

/**
 * Source to use when copying a product photo for WhatsApp and friends.
 *
 * Prefers a share-sized derivative; `fallback` is the full stored image, used when the
 * optimiser cannot serve that path (legacy rows that only have a remote `image_url`, or
 * an optimiser error).
 */
export function resolveShareImageSrc(
  imagePath?: string,
  imageUrl?: string,
): { src: string; fallback: string | null } {
  const path = imagePath?.trim();
  if (path) {
    return {
      src: optimizedProductImageUrl(path, SHARE_IMAGE_WIDTH),
      fallback: publicProductImageApiUrl(path),
    };
  }
  return { src: resolveProductImageSrc(imagePath, imageUrl), fallback: null };
}

export type ResolvedProductImage = {
  src: string;
  /**
   * True when `src` is a third-party URL that `next/image` must not try to optimise —
   * legacy `image_url` values point straight at GCS and can carry expiring signatures,
   * which would poison the optimiser cache.
   */
  unoptimized: boolean;
  /** False when we fell back to the placeholder because the product has no photo. */
  hasImage: boolean;
};

/**
 * Pick the best source for a product photo.
 *
 * `image_path` wins whenever it exists: it routes through our same-origin proxy, which
 * means `next/image` can resize it, the CDN can cache it forever, and no signing round
 * trip is needed before the browser can start the request. `image_url` is only a fallback
 * for rows written before the proxy existed.
 */
export function resolveProductImage(imagePath?: string, imageUrl?: string): ResolvedProductImage {
  const path = imagePath?.trim();
  if (path) {
    return { src: publicProductImageApiUrl(path), unoptimized: false, hasImage: true };
  }
  const url = imageUrl?.trim();
  if (url) {
    return { src: url, unoptimized: true, hasImage: true };
  }
  return { src: DUMMY_IMAGE_PATH, unoptimized: true, hasImage: false };
}

/**
 * Raw source URL, bypassing the optimiser.
 *
 * Used where the full stored image is the point rather than a rendered thumbnail —
 * "Copy image" in the social planner needs the master copy, not a 48px derivative.
 */
export function resolveProductImageSrc(imagePath?: string, imageUrl?: string): string {
  return resolveProductImage(imagePath, imageUrl).src;
}

export async function ensurePngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!png) throw new Error("Could not encode image.");
    return png;
  } finally {
    bitmap.close();
  }
}

export async function fetchImageBlob(src: string, accept?: string): Promise<Blob> {
  const absolute = src.startsWith("/") ? new URL(src, window.location.origin).href : src;
  const res = await fetch(absolute, accept ? { headers: { Accept: accept } } : undefined);
  if (!res.ok) throw new Error("Image fetch failed.");
  const blob = await res.blob();
  const type = blob.type.startsWith("image/")
    ? blob.type
    : res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  if (blob.type === type) return blob;
  return new Blob([await blob.arrayBuffer()], { type });
}

/** Fallback when cross-origin fetch is blocked but the bucket allows CORS on img. */
export function loadImageBlobViaCanvas(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable."));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image."))), "image/png");
    };
    img.onerror = () => reject(new Error("Image load failed."));
    img.src = src.startsWith("/") ? new URL(src, window.location.origin).href : src;
  });
}

export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard image copy is not supported in this browser.");
  }
  const png = await ensurePngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
