import test from "node:test";
import assert from "node:assert/strict";
import {
  archivedProductIds,
  isProductActive,
  isProductArchived,
  partitionProducts,
} from "./archive.ts";

test("a product with no is_active field is active", () => {
  // Every product created before the flag existed looks like this. Treating the
  // absent field as archived would empty the catalog, so this case is the whole
  // reason the predicate exists.
  assert.equal(isProductActive({}), true);
  assert.equal(isProductArchived({}), false);
});

test("is_active false archives, true and undefined do not", () => {
  assert.equal(isProductActive({ is_active: false }), false);
  assert.equal(isProductActive({ is_active: true }), true);
  assert.equal(isProductActive({ is_active: undefined }), true);
  assert.equal(isProductArchived({ is_active: false }), true);
});

test("partitionProducts splits rows and preserves order", () => {
  const rows = [
    { id: "a" },
    { id: "b", is_active: false },
    { id: "c", is_active: true },
    { id: "d", is_active: false },
  ];

  const { active, archived } = partitionProducts(rows);

  assert.deepEqual(
    active.map((r) => r.id),
    ["a", "c"],
  );
  assert.deepEqual(
    archived.map((r) => r.id),
    ["b", "d"],
  );
});

test("partitionProducts handles an empty list", () => {
  const { active, archived } = partitionProducts([]);
  assert.deepEqual(active, []);
  assert.deepEqual(archived, []);
});

test("archivedProductIds collects only archived ids", () => {
  const ids = archivedProductIds([
    { id: "keep", data: {} },
    { id: "gone", data: { is_active: false } },
    { id: "alive", data: { is_active: true } },
  ]);

  assert.equal(ids.size, 1);
  assert.ok(ids.has("gone"));
  assert.ok(!ids.has("keep"));
});
