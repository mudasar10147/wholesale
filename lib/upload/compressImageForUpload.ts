"use client";

/**
 * Shrink product photos in the browser before POSTing to `/api/products/image/upload`.
 *
 * Three jobs:
 *  1. Upload speed. On shop wifi (~5 Mbps) a 7.9 MB AI-generated PNG takes ~13 seconds to
 *     send. Re-encoding to well under 1 MB first makes that about one second.
 *  2. Vercel rejects request bodies above ~4.5 MB, so anything larger must shrink or fail.
 *  3. Quality. This aims at exactly the dimensions and format the server wants to store,
 *     so the server keeps these bytes verbatim instead of re-encoding them. That leaves
 *     the photo with a single lossy step on its way from camera to bucket rather than two.
 *
 * See `imageTargets.ts` for the numbers, and `imageProcessing.ts` for the server half.
 */

import {
  CLIENT_JPEG_FALLBACK_QUALITY,
  CLIENT_TARGET_BYTES,
  CLIENT_WEBP_QUALITY,
  MAX_STORED_LONG_SIDE,
  VERCEL_SAFE_UPLOAD_MAX_BYTES,
} from "@/lib/upload/imageTargets";

export { VERCEL_SAFE_UPLOAD_MAX_BYTES };

const COMPRESSIBLE_MIME = /^image\/(jpeg|png|webp)$/i;

type Encoding = { mime: "image/webp" | "image/jpeg"; ext: "webp" | "jpg" };

let cachedEncoding: Encoding | null = null;

function encodeCanvas(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

/**
 * WebP is roughly a third the size of JPEG at matching quality, and is what the server
 * stores — so producing it here is what lets the server keep our bytes untouched instead
 * of re-encoding them. `toBlob` silently substitutes another format when a type is
 * unsupported, so probe and check what actually came back.
 *
 * The probe draws real pixels onto a small canvas rather than testing a blank 1x1: some
 * encoders short-circuit degenerate input, which made an earlier 1x1 version report no
 * WebP support on Safari and silently cost every upload a JPEG-sized payload plus a
 * second server-side encode.
 */
export async function probeCanvasEncoding(): Promise<Encoding> {
  if (cachedEncoding) return cachedEncoding;
  try {
    const probe = document.createElement("canvas");
    probe.width = 8;
    probe.height = 8;
    const ctx = probe.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(0, 0, 8, 8);
      ctx.fillStyle = "#f97316";
      ctx.fillRect(0, 0, 4, 4);
    }
    const blob = await encodeCanvas(probe, "image/webp", 0.8);
    cachedEncoding =
      blob?.type === "image/webp" && blob.size > 0
        ? { mime: "image/webp", ext: "webp" }
        : { mime: "image/jpeg", ext: "jpg" };
  } catch {
    cachedEncoding = { mime: "image/jpeg", ext: "jpg" };
  }
  return cachedEncoding;
}

/** Diagnostics only: what the probe actually saw, without the cached short-circuit. */
export async function describeCanvasEncoderSupport(): Promise<{
  webpType: string;
  webpBytes: number;
  jpegType: string;
  chosen: string;
}> {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillStyle = "#f97316";
    ctx.fillRect(0, 0, 4, 4);
  }
  const webp = await encodeCanvas(canvas, "image/webp", 0.8).catch(() => null);
  const jpeg = await encodeCanvas(canvas, "image/jpeg", 0.8).catch(() => null);
  const chosen = await probeCanvasEncoding();
  return {
    webpType: webp ? webp.type || "(empty type)" : "(toBlob returned null)",
    webpBytes: webp?.size ?? 0,
    jpegType: jpeg ? jpeg.type || "(empty type)" : "(toBlob returned null)",
    chosen: chosen.mime,
  };
}

async function pickEncoding(): Promise<Encoding> {
  return probeCanvasEncoding();
}

function blobToFile(blob: Blob, baseName: string, encoding: Encoding): File {
  const base = baseName.replace(/\.[^.]+$/i, "").trim() || "product";
  const truncated = base.length > 120 ? base.slice(0, 120) : base;
  return new File([blob], `${truncated}.${encoding.ext}`, {
    type: encoding.mime,
    lastModified: Date.now(),
  });
}

/**
 * Returns the file unchanged when it is already within the stored bounds — the server
 * will encode it once. Otherwise redraws it at or below {@link MAX_STORED_LONG_SIDE} and
 * steps quality down from {@link CLIENT_WEBP_QUALITY} until it fits
 * {@link CLIENT_TARGET_BYTES}. Never returns something larger than it was given.
 */
export async function maybeCompressProductImage(file: File): Promise<File> {
  if (!COMPRESSIBLE_MIME.test(file.type)) {
    // HEIC/HEIF: the browser cannot decode these to a canvas. The server reports a clear
    // error asking for a JPEG export rather than storing something unviewable.
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const iw = bitmap.width;
    const ih = bitmap.height;
    if (iw < 1 || ih < 1) {
      return file;
    }

    // Small and modestly sized already: shipping it as-is costs little and lets the
    // server perform the one and only re-encode.
    if (file.size <= CLIENT_TARGET_BYTES && Math.max(iw, ih) <= MAX_STORED_LONG_SIDE) {
      return file;
    }

    const encoding = await pickEncoding();
    let smallest: Blob | null = null;
    let maxLongSide = MAX_STORED_LONG_SIDE;

    for (let round = 0; round < 6; round++) {
      const scale = Math.min(1, maxLongSide / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      if (encoding.mime === "image/jpeg") {
        // JPEG has no alpha channel, so a transparent PNG (common from AI image tools)
        // would composite to black. WebP keeps transparency, so it must NOT be underlaid.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(bitmap, 0, 0, w, h);

      // WebP output is stored verbatim, so it is worth encoding well. JPEG output only
      // exists to reach the server, which re-encodes it — spending bytes on quality here
      // buys nothing but a slower upload.
      const startQuality =
        encoding.mime === "image/webp" ? CLIENT_WEBP_QUALITY : CLIENT_JPEG_FALLBACK_QUALITY;

      for (let quality = startQuality; quality >= 0.45; quality -= 0.1) {
        const blob = await encodeCanvas(canvas, encoding.mime, quality);
        if (!blob || blob.size === 0) continue;
        if (!smallest || blob.size < smallest.size) {
          smallest = blob;
        }
        if (blob.size <= CLIENT_TARGET_BYTES) {
          return blobToFile(blob, file.name, encoding);
        }
      }

      maxLongSide = Math.round(maxLongSide * 0.75);
      if (maxLongSide < 640) break;
    }

    // Never hand back something bigger than we started with.
    if (smallest && smallest.size < file.size) {
      return blobToFile(smallest, file.name, encoding);
    }
  } finally {
    bitmap.close();
  }

  return file;
}
