import assert from "node:assert/strict";
import test from "node:test";
import {
  describePostGap,
  normalizePostFormat,
  POST_TYPE_SPECS,
  POST_TYPES,
  postTypeOf,
  specOf,
  type PostContentCounts,
  type SocialPostType,
} from "./postTypes.ts";

/** A complete post is one describePostGap has nothing left to say about. */
function complete(overrides: Partial<PostContentCounts> = {}): PostContentCounts {
  return { products: 1, mediaLinks: 1, captionLength: 20, hasOffer: true, ...overrides };
}

test("every type round-trips through what it writes", () => {
  for (const type of POST_TYPES) {
    const spec = specOf(type);
    assert.equal(
      postTypeOf({ kind: spec.defaultKind, format: spec.format }),
      type,
      `${type} did not read back as itself`,
    );
  }
});

test("a product post keeps its type whichever lens sourced its products", () => {
  for (const kind of ["products", "random", "best_sellers", "aging_stock", "new_arrivals"] as const) {
    assert.equal(postTypeOf({ kind, format: "image_text" }), "product");
  }
});

test("the offer kind is what separates an offer post from a product post", () => {
  assert.equal(postTypeOf({ kind: "offer", format: "image_text" }), "offer");
  assert.equal(postTypeOf({ kind: "products", format: "image_text" }), "product");
});

test("legacy formats read as the type they were", () => {
  // `image` and `video` meant "media, no message". Nothing writes them any more, but posts
  // that carry them must still open — as the type whose medium they are.
  assert.equal(postTypeOf({ kind: "random", format: "image" }), "product");
  assert.equal(postTypeOf({ kind: "offer", format: "image" }), "offer");
  assert.equal(postTypeOf({ kind: "custom", format: "video" }), "video");
});

test("a post written before formats existed reads as a product post", () => {
  assert.equal(postTypeOf({ kind: "random", format: undefined }), "product");
  assert.equal(normalizePostFormat(undefined), "image_text");
  assert.equal(normalizePostFormat("nonsense"), "image_text");
  assert.equal(normalizePostFormat("video_text"), "video_text");
});

test("a video post is a video post even when it carries products", () => {
  assert.equal(postTypeOf({ kind: "best_sellers", format: "video_text" }), "video");
});

test("a product post needs products, then a message", () => {
  assert.match(
    describePostGap("product", complete({ products: 0 }))!,
    /at least one product/,
  );
  assert.match(
    describePostGap("product", complete({ products: 2, captionLength: 0 }))!,
    /Write the message/,
  );
  assert.equal(describePostGap("product", complete()), null);
});

test("a product post does not need a media link", () => {
  assert.equal(describePostGap("product", complete({ mediaLinks: 0 })), null);
});

test("an offer post cannot be saved without its offer", () => {
  assert.match(describePostGap("offer", complete({ hasOffer: false }))!, /Pick the offer/);
  assert.equal(describePostGap("offer", complete()), null);
});

test("a video post needs the link, and nothing else", () => {
  assert.match(describePostGap("video", complete({ mediaLinks: 0 }))!, /video link/);
  // The video is the post — the message and the products are both optional.
  assert.equal(describePostGap("video", complete({ products: 0, captionLength: 0 })), null);
});

test("a message-only post needs only the message", () => {
  assert.match(describePostGap("message", complete({ captionLength: 0 }))!, /Write the message/);
  assert.equal(
    describePostGap("message", complete({ products: 0, mediaLinks: 0, hasOffer: false })),
    null,
  );
});

test("a whitespace-only message does not count — the editor trims before it counts", () => {
  assert.notEqual(describePostGap("message", complete({ captionLength: 0 })), null);
});

test("only the offer post asks for an offer", () => {
  const withOffer = POST_TYPES.filter((type) => POST_TYPE_SPECS[type].sections.offer);
  assert.deepEqual(withOffer, ["offer"]);
});

test("a section a type does not have can never block its save", () => {
  // The editor zeroes the counts for every hidden section. A type must be completable with
  // nothing but the sections it actually shows.
  for (const type of POST_TYPES as readonly SocialPostType[]) {
    const spec = specOf(type);
    const counts: PostContentCounts = {
      products: spec.sections.products ? 1 : 0,
      mediaLinks: spec.sections.media ? 1 : 0,
      captionLength: spec.sections.message ? 20 : 0,
      hasOffer: spec.sections.offer,
    };
    assert.equal(describePostGap(type, counts), null, `${type} could not be completed`);
  }
});

test("a type that hides its products never sources a kind from them", () => {
  for (const type of POST_TYPES) {
    const spec = specOf(type);
    if (spec.sourcedKind) {
      assert.equal(spec.sections.products, true, `${type} sources a kind but has no products`);
    }
  }
});
