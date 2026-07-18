"use client";

import {
  copyImageBlobToClipboard,
  fetchImageBlob,
  loadImageBlobViaCanvas,
  resolveProductImageSrc,
} from "@/lib/upload/productImageDisplay";
import type { SocialProductRow } from "@/lib/social/types";

/** Pre-Clipboard-API fallback. Still needed on older mobile Safari. */
function legacyCopyText(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Resolves false when the browser blocked the copy; callers surface their own message. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  return legacyCopyText(text);
}

export const IMAGE_COPY_FAILED_MESSAGE =
  "Could not copy image. Use HTTPS, try Chrome or Safari, or long-press the product photo to save it.";

export async function copyProductImage(product: SocialProductRow): Promise<boolean> {
  const src = resolveProductImageSrc(product.imagePath, product.imageUrl);
  try {
    let blob: Blob;
    try {
      blob = await fetchImageBlob(src);
    } catch {
      // A remote image_url with no stored path can still be read through a canvas.
      const fallbackUrl = product.imageUrl?.trim();
      if (!product.imagePath?.trim() && fallbackUrl) {
        blob = await loadImageBlobViaCanvas(fallbackUrl);
      } else {
        throw new Error("fetch failed");
      }
    }
    await copyImageBlobToClipboard(blob);
    return true;
  } catch {
    return false;
  }
}
