/**
 * assertAllInvariants(db) — runs the ENTIRE register against live emulator state
 * and throws on any blocking (CRITICAL/ERROR) violation (§12.3). Call it after
 * every mutation in every integration test: a new operation then cannot break an
 * old invariant without a test failing, even when nobody wrote that specific test.
 *
 * Admin SDK (emulator). WARNING-severity findings do not throw (the validator is
 * not born red — L6/COGS etc. are transitional WARNINGs).
 */

import type { Firestore } from "firebase-admin/firestore";
import { validateInventoryData, type ValidationReport } from "@/lib/inventory/validateInventory";
import { entityOf, loadAllInventory } from "@/lib/inventory/validationRun";

export type AssertAllOptions = {
  /** Invariant ids allowed to fail without throwing (e.g. a fixture's known drift). */
  allow?: string[];
};

export async function assertAllInvariants(db: Firestore, opts: AssertAllOptions = {}): Promise<ValidationReport> {
  const report = validateInventoryData(await loadAllInventory(db));
  const allow = new Set(opts.allow ?? []);
  const blocking = report.issues.filter(
    (i) => (i.severity === "CRITICAL" || i.severity === "ERROR") && !allow.has(i.invariant_id),
  );
  if (blocking.length > 0) {
    const detail = blocking
      .map((i) => {
        const e = entityOf(i);
        return `${i.invariant_id}[${i.severity}] ${e.type}:${e.id} — ${i.message}`;
      })
      .join("\n  ");
    throw new Error(`assertAllInvariants: ${blocking.length} blocking violation(s):\n  ${detail}`);
  }
  return report;
}
