import path from "node:path";
import type { NextConfig } from "next";

const ONE_YEAR_SECONDS = 31536000;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "storage.googleapis.com", pathname: "/**" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com", pathname: "/**" },
    ],

    // Product photos render through /api/products/image/public, a same-origin route, so
    // the optimiser resizes and re-encodes them instead of shipping the stored master
    // copy to a 48px thumbnail slot.
    //
    // WebP only, on purpose: AVIF saves a further ~20% but costs ~50% more encode time on
    // the first request for each size. The stored-master change already does the heavy
    // lifting, so the extra bytes are not worth a slower cold path. Add "image/avif" ahead
    // of webp here if that trade ever flips.
    formats: ["image/webp"],

    // Required from Next 16 — an unlisted `quality` is coerced to the nearest allowed value.
    qualities: [75],

    // Object names carry an upload timestamp and are never rewritten, so a cached
    // derivative can never go stale: replacing a product photo produces a new path and
    // therefore a new cache key.
    minimumCacheTTL: ONE_YEAR_SECONDS,

    // Trimmed to the widths this app actually renders. The defaults reach 3840px, which
    // only ever means encoding sizes nothing requests. Small entries cover the 32-48px
    // product thumbnails at 1x and 2x.
    // 1600 is here on purpose: it is the size WhatsApp re-encodes pasted photos down to,
    // and "Copy image" requests exactly that width (see SHARE_IMAGE_WIDTH).
    deviceSizes: [640, 750, 828, 1080, 1200, 1600, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],

    // Next 16 defaults to `[{ search: "" }]` for local images — a local src carrying any
    // query string is rejected with "url parameter is not allowed". Product photos are
    // addressed as ?path=..., so the image route needs an explicit entry that permits a
    // search. Safe here because the route handler itself rejects any path outside
    // products/. The second entry restores the stock behaviour for everything else, so
    // /public assets keep working.
    localPatterns: [
      { pathname: "/api/products/image/public" },
      { pathname: "/**", search: "" },
    ],
  },
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
