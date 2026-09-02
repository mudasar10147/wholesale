/**
 * Run: npm run test:images
 */
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  MAX_STORED_LONG_SIDE,
  optimizeUploadedImageFile,
  processProductImage,
} from "./imageProcessing.ts";
import { MAX_ACCEPTED_STORED_BYTES } from "./imageTargets.ts";

/**
 * Flat colours compress to nothing and would make every size assertion meaningless,
 * so build something with real per-pixel detail — the way a photo behaves.
 */
async function noisyImage(width: number, height: number, format: "jpeg" | "png" | "webp") {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (i * 2654435761) % 256;
  }
  const image = sharp(pixels, { raw: { width, height, channels: 3 } });
  if (format === "jpeg") return image.jpeg({ quality: 95 }).toBuffer();
  if (format === "png") return image.png().toBuffer();
  return image.webp({ quality: 90 }).toBuffer();
}

/**
 * Pure noise is the worst case for any codec and lands far outside realistic sizes.
 * A light blur restores the frequency profile of an actual photograph, which is what
 * the size-bound assertions need to be meaningful.
 */
async function photoImage(width: number, height: number) {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (i * 2654435761) % 256;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).blur(1.2).png().toBuffer();
}

test("bounds an oversized phone photo and re-encodes it to WebP", async () => {
  const original = await noisyImage(4000, 3000, "jpeg");
  const result = await processProductImage(original, "image/jpeg", "IMG_0001.JPG");

  assert.equal(result.optimized, true);
  assert.equal(result.contentType, "image/webp");
  assert.equal(result.extension, ".webp");
  assert.equal(result.width, MAX_STORED_LONG_SIDE);
  assert.equal(result.height, 1500, "aspect ratio must be preserved");
  assert.ok(
    result.buffer.byteLength < original.byteLength,
    `expected a smaller file, got ${result.buffer.byteLength} vs ${original.byteLength}`,
  );
});

test("never upscales an image that is already smaller than the ceiling", async () => {
  const original = await noisyImage(300, 200, "png");
  const result = await processProductImage(original, "image/png", "small.png");

  assert.equal(result.optimized, true);
  assert.equal(result.width, 300);
  assert.equal(result.height, 200);
});

test("leaves an already-bounded, already-small WebP untouched", async () => {
  const original = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .webp({ quality: 70 })
    .toBuffer();

  const result = await processProductImage(original, "image/webp", "thumb.webp");

  assert.equal(result.optimized, true);
  assert.equal(result.buffer, original, "should hand back the exact same buffer, not a re-encode");
});

test("stores a browser-sized WebP verbatim instead of re-encoding it", async () => {
  // What compressImageForUpload.ts produces: already at the stored bounds, so a second
  // encode here would cost quality for nothing.
  const fromBrowser = await sharp(await photoImage(2000, 1500)).webp({ quality: 85 }).toBuffer();
  assert.ok(fromBrowser.byteLength <= MAX_ACCEPTED_STORED_BYTES, "fixture must be within bounds");

  const result = await processProductImage(fromBrowser, "image/webp", "IMG_1.webp");

  assert.equal(result.optimized, true);
  assert.equal(result.buffer, fromBrowser, "must be the identical buffer — no second encode");
});

test("re-encodes a WebP that exceeds the stored dimensions", async () => {
  const tooBig = await sharp(await photoImage(3000, 2000)).webp({ quality: 85 }).toBuffer();

  const result = await processProductImage(tooBig, "image/webp", "big.webp");

  assert.equal(result.optimized, true);
  assert.notEqual(result.buffer, tooBig, "out-of-bounds input must not pass through");
  assert.equal(result.width, MAX_STORED_LONG_SIDE);
});

test("does not pass through a WebP whose EXIF orientation still needs applying", async () => {
  // A bounded WebP carrying orientation 6 must be rotated, not stored as-is — otherwise
  // the fast path would put a sideways photo in the bucket.
  const rotated = await sharp({
    create: { width: 600, height: 900, channels: 3, background: { r: 40, g: 80, b: 120 } },
  })
    .withMetadata({ orientation: 6 })
    .webp({ quality: 85 })
    .toBuffer();

  const result = await processProductImage(rotated, "image/webp", "sideways.webp");

  assert.equal(result.optimized, true);
  assert.equal(result.width, 900, "orientation must have been applied");
  assert.equal(result.height, 600);
});

test("bakes in EXIF orientation so portrait shots do not render sideways", async () => {
  // Orientation 6 means "rotate 90° clockwise to display", so the displayed image is
  // the transpose of the stored one.
  const original = await sharp({
    create: { width: 100, height: 200, channels: 3, background: { r: 90, g: 90, b: 90 } },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

  const result = await processProductImage(original, "image/jpeg", "portrait.jpg");

  assert.equal(result.optimized, true);
  assert.equal(result.width, 200);
  assert.equal(result.height, 100);
});

test("passes non-image uploads through untouched", async () => {
  const pdf = Buffer.from("%PDF-1.4 not really a pdf");
  const result = await processProductImage(pdf, "application/pdf", "invoice.pdf");

  assert.equal(result.optimized, false);
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.extension, ".pdf");
  assert.equal(result.buffer, pdf);
});

test("passes undecodable bytes through rather than failing the upload", async () => {
  const junk = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);
  const result = await processProductImage(junk, "image/jpeg", "corrupt.jpg");

  assert.equal(result.optimized, false);
  assert.equal(result.buffer, junk);
});

test("optimizeUploadedImageFile returns a WebP File named to match", async () => {
  const original = await noisyImage(2600, 2600, "jpeg");
  const input = new File([new Uint8Array(original)], "IMG_1234.JPG", { type: "image/jpeg" });

  const { file, result } = await optimizeUploadedImageFile(input, "image/jpeg");

  assert.equal(result.optimized, true);
  assert.equal(file.name, "IMG_1234.webp");
  assert.equal(file.type, "image/webp");
  assert.equal(file.size, result.buffer.byteLength);
  assert.ok(file.size < input.size);
});

test("optimizeUploadedImageFile returns the original File when it cannot decode", async () => {
  const input = new File([new Uint8Array(Buffer.from("nope"))], "photo.heic", { type: "image/heic" });

  const { file, result } = await optimizeUploadedImageFile(input, "image/heic");

  assert.equal(result.optimized, false);
  assert.equal(file, input, "caller relies on identity to detect the passthrough");
});
