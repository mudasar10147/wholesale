/**
 * Coverage gate (§12.5): every register invariant must be EITHER
 *   - implemented (has a `check`) AND have a detection test that violates it, OR
 *   - carry a documented `coverage` skip reason.
 * No invariant may be silently uncovered. CI runs this and fails the build on a gap.
 *
 * Run: npm run check:coverage
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INVARIANTS } from "../lib/inventory/invariants.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const detectionSrc = fs.readFileSync(path.join(ROOT, "lib/inventory/validateInventory.detection.test.ts"), "utf8");
const tested = new Set([...detectionSrc.matchAll(/detects\("([A-Za-z0-9]+)"/g)].map((m) => m[1]));

const errors = [];
for (const inv of INVARIANTS) {
  const implemented = typeof inv.check === "function";
  const skipped = Boolean(inv.coverage);

  if (implemented && skipped) errors.push(`${inv.id}: has BOTH a check and a coverage-skip — pick one.`);
  if (!implemented && !skipped) errors.push(`${inv.id}: SILENT GAP — no check and no documented coverage-skip.`);
  if (implemented && !tested.has(inv.id)) errors.push(`${inv.id}: implemented but has no detection test (expected detects("${inv.id}", ...)).`);
  if (skipped && !inv.coverage.reason?.trim()) errors.push(`${inv.id}: coverage-skip is missing a reason.`);
}

const impl = INVARIANTS.filter((i) => i.check).length;
const skip = INVARIANTS.filter((i) => i.coverage).length;
console.log(`Register coverage: ${INVARIANTS.length} invariants — ${impl} implemented+tested, ${skip} documented-skip.`);
const byStatus = {};
for (const i of INVARIANTS) if (i.coverage) byStatus[i.coverage.status] = (byStatus[i.coverage.status] ?? 0) + 1;
if (skip) console.log(`  skips: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(", ")}`);

if (errors.length) {
  console.error("\nCOVERAGE GATE FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("Coverage gate PASSED: every invariant is implemented+tested or documented-skip — no silent gaps.");
