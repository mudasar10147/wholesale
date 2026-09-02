/**
 * Server-only image normalisation for product photos.
 *
 * Phone cameras and AI image tools hand us 7-8 MB originals. Storing those verbatim makes
 * every read expensive forever: GCS egress, serverless memory, and (once `next/image` is
 * in front) a slow first optimise per requested width. So the bucket only ever holds a
 * bounded WebP master, and `next/image` derives the per-viewport sizes from that.
 *
 * The photo takes **exactly one lossy step** on its way here. The browser normally does
 * it (see `compressImageForUpload.ts`), encoding straight to the bounds below so this
 * function can store those bytes untouched. When the browser could not — an unsupported
 * codec, an image already small enough to send as-is, or a non-browser caller — this
 * function performs that single step instead.
 */
import path from "node:path";
import {
  MAX_ACCEPTED_STORED_BYTES,
  MAX_STORED_LONG_SIDE,
  STORED_WEBP_QUALITY,
} from "@/lib/upload/imageTargets";

export { MAX_STORED_LONG_SIDE, STORED_WEBP_QUALITY };

/** Formats sharp can reliably decode with the prebuilt binaries we ship. */
const PROCESSABLE_MIME = /^image\/(jpeg|png|webp|avif|tiff|gif)$/i;

export type ProcessedImage = {
  buffer: Buffer;
  /** Mime type of `buffer` — `image/webp` when we re-encoded, else the input type. */
  contentType: string;
  /** File extension matching `contentType`, including the dot. */
  extension: string;
  width?: number;
  height?: number;
  /** False when we deliberately (or unavoidably) stored the bytes as they arrived. */
  optimized: boolean;
};

function extensionForMime(mimeType: string, fallbackName: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/webp":
      return ".webp";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "application/pdf":
      return ".pdf";
    default: {
      const ext = path.extname(fallbackName).toLowerCase();
      return ext || ".bin";
    }
  }
}

function passthrough(buffer: Buffer, mimeType: string, fileName: string): ProcessedImage {
  return {
    buffer,
    contentType: mimeType,
    extension: extensionForMime(mimeType, fileName),
    optimized: false,
  };
}

/**
 * Re-encode `buffer` to a bounded WebP. Never throws: anything sharp cannot decode
 * (HEIC without libheif, PDFs, corrupt uploads) is returned unchanged so the upload
 * still succeeds — a large image beats a failed save.
 */
export async function processProductImage(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ProcessedImage> {
  if (!PROCESSABLE_MIME.test(mimeType)) {
    return passthrough(buffer, mimeType, fileName);
  }

  try {
    const { default: sharp } = await import("sharp");

    // `rotate()` with no argument bakes in EXIF orientation, so portrait phone shots
    // do not render sideways once the metadata is stripped by the re-encode.
    const pipeline = sharp(buffer, { failOn: "none" }).rotate();
    const metadata = await pipeline.metadata();

    // The browser already encodes to exactly these bounds (see compressImageForUpload.ts).
    // Storing its output verbatim is the whole point: a second encode here would put the
    // photo through two lossy passes for no gain. Dimensions and size are re-checked from
    // the decoded metadata rather than trusted from the request, so a malformed or
    // oversized upload still gets normalised below.
    const longSide = Math.max(metadata.width ?? 0, metadata.height ?? 0);
    const needsRotation = typeof metadata.orientation === "number" && metadata.orientation > 1;
    const alreadyWithinBounds =
      metadata.format === "webp" &&
      !needsRotation &&
      buffer.byteLength <= MAX_ACCEPTED_STORED_BYTES &&
      longSide > 0 &&
      longSide <= MAX_STORED_LONG_SIDE;

    if (alreadyWithinBounds) {
      return {
        buffer,
        contentType: "image/webp",
        extension: ".webp",
        ...(metadata.width !== undefined ? { width: metadata.width } : {}),
        ...(metadata.height !== undefined ? { height: metadata.height } : {}),
        optimized: true,
      };
    }

    const { data, info } = await pipeline
      // `withoutEnlargement` keeps small images at their native size instead of
      // upscaling them into a bigger file with no extra detail.
      .resize({
        width: MAX_STORED_LONG_SIDE,
        height: MAX_STORED_LONG_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: STORED_WEBP_QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      contentType: "image/webp",
      extension: ".webp",
      width: info.width,
      height: info.height,
      optimized: true,
    };
  } catch {
    // sharp missing, unsupported codec, or a malformed file — store the original.
    return passthrough(buffer, mimeType, fileName);
  }
}

/**
 * Convenience wrapper for the upload route: takes the multipart `File`, returns a
 * `File` carrying the optimised bytes and a matching name/extension.
 */
export async function optimizeUploadedImageFile(
  file: File,
  mimeType: string,
): Promise<{ file: File; result: ProcessedImage }> {
  const original = Buffer.from(await file.arrayBuffer());
  const result = await processProductImage(original, mimeType, file.name);

  if (!result.optimized) {
    return { file, result };
  }

  const base = path.basename(file.name, path.extname(file.name)) || "product";
  const optimized = new File([new Uint8Array(result.buffer)], `${base}${result.extension}`, {
    type: result.contentType,
    lastModified: Date.now(),
  });
  return { file: optimized, result };
}
