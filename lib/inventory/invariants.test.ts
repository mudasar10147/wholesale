/**
 * Register integrity + coverage. Run:
 *   node --experimental-strip-types --test lib/inventory/invariants.test.ts
 *
 * This does not test detection logic (that is validateInventory's job); it guards
 * the register itself — unique ids, consistent metadata, and a countable coverage
 * number so "how much is covered" is a fact, not a belief (§7.9).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { INVARIANTS, getInvariant, registerCoverage } from "./invariants.ts";

const SEVERITIES = new Set(["CRITICAL", "ERROR", "WARNING"]);
const CATEGORIES = new Set([
  "product",
  "lot",
  "consumption",
  "invoice",
  "return",
  "discard_adjustment",
  "ledger",
  "cash",
]);

test("every invariant id is unique", () => {
  const ids = INVARIANTS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate invariant id in the register");
});

test("every invariant carries complete, valid metadata", () => {
  for (const inv of INVARIANTS) {
    assert.ok(inv.title.trim(), `${inv.id} missing title`);
    assert.ok(inv.description.trim(), `${inv.id} missing description`);
    assert.ok(inv.investigation.trim(), `${inv.id} missing investigation`);
    assert.ok(SEVERITIES.has(inv.severity), `${inv.id} bad severity ${inv.severity}`);
    assert.ok(CATEGORIES.has(inv.category), `${inv.id} bad category ${inv.category}`);
    assert.ok(inv.enforcement.length > 0, `${inv.id} has no enforcement point`);
  }
});

test("deploy-blocking matches severity (CRITICAL/ERROR block, WARNING does not)", () => {
  for (const inv of INVARIANTS) {
    const expected = inv.severity !== "WARNING";
    assert.equal(inv.deployBlocking, expected, `${inv.id} deployBlocking should be ${expected}`);
  }
});

test("a WARNING that escalates records its eventual grade and trigger", () => {
  for (const inv of INVARIANTS) {
    if (inv.escalatesTo) {
      assert.ok(SEVERITIES.has(inv.escalatesTo.severity), `${inv.id} escalatesTo bad severity`);
      assert.ok(inv.escalatesTo.when.trim(), `${inv.id} escalatesTo missing trigger`);
    }
  }
});

test("implemented checks are functions; coverage arithmetic is consistent", () => {
  const cov = registerCoverage();
  assert.equal(cov.total, INVARIANTS.length);
  assert.equal(cov.implemented + cov.pending, cov.total);
  assert.equal(cov.implementedIds.length, cov.implemented);
  assert.equal(cov.pendingIds.length, cov.pending);
  for (const id of cov.implementedIds) {
    assert.equal(typeof getInvariant(id)?.check, "function", `${id} declared implemented but has no check`);
  }
  for (const id of cov.pendingIds) {
    assert.equal(getInvariant(id)?.check, undefined, `${id} declared pending but has a check`);
  }
});

test("the constitutions P1 and L6 are present and implemented", () => {
  assert.equal(typeof getInvariant("P1")?.check, "function");
  assert.equal(typeof getInvariant("L6")?.check, "function");
  assert.equal(getInvariant("P1")?.severity, "CRITICAL");
});

test("coverage is reported (visibility of the remaining M1 work)", () => {
  const cov = registerCoverage();
  // Not an enforced target in M1 (that moves to M1.5) — just make it observable.
  console.log(`register coverage: ${cov.implemented}/${cov.total} implemented; pending: ${cov.pendingIds.join(", ")}`);
  assert.ok(cov.implemented > 0);
});
