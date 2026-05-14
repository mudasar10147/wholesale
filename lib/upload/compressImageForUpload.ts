"use client";

/**
 * Re-encode product photos in the browser before POSTing to `/api/products/image/upload`.
 * Vercel serverless rejects bodies above ~4.5 MB (`FUNCTION_PAYLOAD_TOO_LARGE` / HTTP 413).
 * We target well under that to leave room for multipart boundaries.
 */
export const VERCEL_SAFE_UPLOAD_MAX_BYTES = 3 * 1024 * 1024; // 3 MiB

const COMPRESS_MIME_PREFIX = /^image\/(jpeg|png|webp)$/i;

function jpegBlobToFile(blob: Blob, baseName: string): File {
  const base = baseName.replace(/\.[^.]+$/i, "").trim() || "product";
  const truncated = base.length > 120 ? base.slice(0, 120) : base;
  return new File([blob], `${truncated}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

/**
 * If the file is already small enough, returns it unchanged.
 * Otherwise decodes with `createImageBitmap`, draws to canvas, and emits JPEG with
 * shrinking dimensions / quality until under {@link VERCEL_SAFE_UPLOAD_MAX_BYTES}.
 */
export async function maybeCompressProductImage(file: File): Promise<File> {
  if (file.size <= VERCEL_SAFE_UPLOAD_MAX_BYTES) {
    return file;
  }

  if (!COMPRESS_MIME_PREFIX.test(file.type)) {
    // HEIC/HEIF/PDF: skip client compression; caller may still hit 413 on huge HEIC
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

    let maxLongSide = 2560;
    let quality = 0.9;

    for (let round = 0; round < 12; round++) {
      const longSide = Math.max(iw, ih);
      const scale = Math.min(1, maxLongSide / longSide);
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        break;
      }
      ctx.drawImage(bitmap, 0, 0, w, h);

      for (let qStep = 0; qStep < 10; qStep++) {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
        });
        if (blob && blob.size > 0 && blob.size <= VERCEL_SAFE_UPLOAD_MAX_BYTES) {
          return jpegBlobToFile(blob, file.name);
        }
        quality -= 0.07;
        if (quality < 0.42) {
          break;
        }
      }

      maxLongSide = Math.round(maxLongSide * 0.82);
      if (maxLongSide < 480) {
        break;
      }
    }

    // Last resort: tiny canvas
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 800 / Math.max(iw, ih));
    canvas.width = Math.max(1, Math.round(iw * scale));
    canvas.height = Math.max(1, Math.round(ih * scale));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.4);
      });
      if (blob && blob.size > 0 && blob.size <= VERCEL_SAFE_UPLOAD_MAX_BYTES) {
        return jpegBlobToFile(blob, file.name);
      }
    }
  } finally {
    bitmap.close();
  }

  return file;
}
