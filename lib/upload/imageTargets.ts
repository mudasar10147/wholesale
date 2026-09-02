/**
 * Targets shared by the browser compressor and the server processor.
 *
 * These two halves have to agree. If the browser hands over something the server
 * considers out of bounds, the server re-encodes it — and a photo that has been through
 * two lossy encodes looks worse than one that went through a single, better one. Keeping
 * the numbers in one file is what makes the single-encode path reliable.
 *
 * Deliberately free of Node and DOM imports so both sides can import it.
 */

/**
 * Longest edge we keep. Above WhatsApp's ~1600px transmission size, so a photo copied
 * into a group is never limited by us, and far above any size the app renders.
 */
export const MAX_STORED_LONG_SIDE = 2000;

/**
 * Quality the browser encodes at. Higher than the server's fallback because this is
 * normally the *only* lossy step the photo ever takes.
 */
export const CLIENT_WEBP_QUALITY = 0.85;

/**
 * Starting quality when the browser can only produce JPEG (older Safari cannot encode
 * WebP from a canvas). Lower than {@link CLIENT_WEBP_QUALITY} on purpose: these bytes are
 * never stored — the server re-encodes them to WebP regardless — so the server's encode,
 * not this one, sets the final quality. Measured: dropping 0.85 to 0.70 here changes the
 * stored master by ~0.1 dB while halving what has to be uploaded.
 */
export const CLIENT_JPEG_FALLBACK_QUALITY = 0.7;

/** Server fallback quality, used only when it has to re-encode. */
export const STORED_WEBP_QUALITY = 78;

/** What the browser aims to produce — small enough to upload quickly on shop wifi. */
export const CLIENT_TARGET_BYTES = 900 * 1024;

/**
 * The largest already-bounded WebP the server will store without re-encoding. Generous
 * headroom over {@link CLIENT_TARGET_BYTES} so a well-formed browser upload reliably
 * takes the no-re-encode path, while anything wildly oversized still gets normalised.
 */
export const MAX_ACCEPTED_STORED_BYTES = 1.5 * 1024 * 1024;

/** Hard ceiling: Vercel rejects request bodies above ~4.5 MB. */
export const VERCEL_SAFE_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
