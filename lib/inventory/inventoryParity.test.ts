/**
 * Run: npm run test:inventory-parity
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateInventoryData, type ValidationInput } from "./validateInventory.ts";

const fixturePath = join(process.cwd(), "test/fixtures/inventory-baseline/baseline.json");
const raw = readFileSync(fixturePath, "utf8");
const baseline = JSON.parse(raw) as ValidationInput;

const report = validateInventoryData(baseline, "fixture");
assert.equal(report.summary.products_checked, 2);
assert.equal(report.summary.lots_checked, 3);

// Baseline is balanced — parity gate for migration
assert.equal(report.summary.errors, 0, `Baseline fixture has errors: ${JSON.stringify(report.issues)}`);

// COGS line should match consumption sum in fixture
const cogsIssue = report.issues.find((i) => i.code === "COGS_MISMATCH");
assert.equal(cogsIssue, undefined);

console.log("inventoryParity.test.ts: baseline parity OK");
