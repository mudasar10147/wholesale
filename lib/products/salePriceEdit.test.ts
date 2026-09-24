import test from "node:test";
import assert from "node:assert/strict";
import {
  belowCostConfirmMessage,
  describeSalePriceChange,
  matchesProductSearch,
  parseSalePriceInput,
  sortProductsByName,
} from "./salePriceEdit.ts";

test("a blank box is not a price of zero", () => {
  // Clearing the input to retype must not read as "sell it for nothing".
  assert.deepEqual(parseSalePriceInput(""), { ok: false, message: "Enter a sale price." });
  assert.deepEqual(parseSalePriceInput("   "), { ok: false, message: "Enter a sale price." });
});

test("digits with anything else in them are refused, not salvaged", () => {
  // parseFloat would read these as 1200, 1 and 12 — the whole reason this parser exists.
  for (const raw of ["1200x", "1 200", "12.5.5", "abc"]) {
    assert.equal(parseSalePriceInput(raw).ok, false, raw);
  }
});

test("negative prices are refused; zero is allowed", () => {
  assert.equal(parseSalePriceInput("-1").ok, false);
  assert.deepEqual(parseSalePriceInput("0"), { ok: true, value: 0 });
});

test("a typed price is rounded to money", () => {
  assert.deepEqual(parseSalePriceInput(" 1350.456 "), { ok: true, value: 1350.46 });
  assert.deepEqual(parseSalePriceInput("1350"), { ok: true, value: 1350 });
});

test("the same price is not a change", () => {
  const change = describeSalePriceChange({ current: 1350, next: 1350, cost: 1000 });
  assert.equal(change.changed, false);
  assert.equal(change.delta, 0);
});

test("a rise reports its size, its percent and its margin", () => {
  const change = describeSalePriceChange({ current: 1000, next: 1200, cost: 900 });
  assert.equal(change.changed, true);
  assert.equal(change.delta, 200);
  assert.equal(change.deltaPercent, 20);
  assert.equal(change.marginPercent, 25); // (1200 - 900) / 1200
  assert.equal(change.belowCost, false);
});

test("a cut below cost is flagged", () => {
  const change = describeSalePriceChange({ current: 1350, next: 900, cost: 1000 });
  assert.equal(change.delta, -450);
  assert.equal(change.belowCost, true);
  assert.ok(change.marginPercent !== null && change.marginPercent < 0);
});

test("selling exactly at cost is not below cost", () => {
  assert.equal(describeSalePriceChange({ current: 1200, next: 1000, cost: 1000 }).belowCost, false);
});

test("a product with no price yet has no percent to move by", () => {
  // Percent change against 0 is meaningless; the row shows the new margin instead.
  const change = describeSalePriceChange({ current: 0, next: 500, cost: 400 });
  assert.equal(change.deltaPercent, null);
  assert.equal(change.changed, true);
  assert.equal(change.marginPercent, 20);
});

test("missing cost and price fields are read as zero, not NaN", () => {
  const change = describeSalePriceChange({ current: undefined, next: 500, cost: undefined });
  assert.equal(change.current, 0);
  assert.equal(change.belowCost, false);
  assert.equal(change.marginPercent, 100);
});

test("a price of zero has no margin", () => {
  assert.equal(describeSalePriceChange({ current: 500, next: 0, cost: 0 }).marginPercent, null);
});

test("sub-cent differences do not count as a change", () => {
  // 1350.004 rounds to the stored 1350, so Save stays off rather than writing a no-op.
  const change = describeSalePriceChange({ current: 1350, next: 1350.004, cost: 1000 });
  assert.equal(change.changed, false);
});

test("the below-cost confirm names the loss per unit", () => {
  const change = describeSalePriceChange({ current: 1350, next: 900, cost: 1000 });
  const message = belowCostConfirmMessage("Basmati Rice", change, 1000);
  assert.match(message, /Basmati Rice/);
  assert.match(message, /900/);
  assert.match(message, /1,000 cost/);
  assert.match(message, /loss of 100 on every unit/);
});

test("search matches name or category, case-insensitively", () => {
  const row = { name: "Basmati Rice", category: "Grains" };
  assert.equal(matchesProductSearch(row, "basmati"), true);
  assert.equal(matchesProductSearch(row, "GRAIN"), true);
  assert.equal(matchesProductSearch(row, "rice"), true);
  assert.equal(matchesProductSearch(row, "sugar"), false);
});

test("an empty search keeps every row", () => {
  assert.equal(matchesProductSearch({ name: "Sugar" }, "   "), true);
  assert.equal(matchesProductSearch({}, ""), true);
});

test("rows sort A→Z regardless of case", () => {
  const sorted = sortProductsByName([
    { name: "sugar" },
    { name: "Basmati Rice" },
    { name: "Atta" },
  ]);
  assert.deepEqual(
    sorted.map((r) => r.name),
    ["Atta", "Basmati Rice", "sugar"],
  );
});

test("sorting leaves the caller's array alone", () => {
  const rows = [{ name: "B" }, { name: "A" }];
  sortProductsByName(rows);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["B", "A"],
  );
});
