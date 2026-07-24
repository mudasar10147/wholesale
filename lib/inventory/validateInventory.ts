/**
 * Register-driven inventory validator (PHASE1_INTEGRITY_ARCHITECTURE_V2.md §7, §8).
 *
 * It iterates the invariant register (invariants.ts) and NEVER carries its own
 * list of checks. Every emitted issue joins to the register by `invariant_id`, so
 * its severity can never disagree with the register. Legacy `code` and the
 * two-level `summary.errors/warnings` are retained for existing consumers.
 */

import {
  INVARIANTS,
  registerCoverage,
  type InvariantSeverity,
  type RegisterCoverage,
} from "@/lib/inventory/invariants";
import {
  buildValidationContext,
  type InvariantFinding,
  type ValidationInput,
} from "@/lib/inventory/validationContext";
import type { ValidationIssueCode, ValidationSeverity } from "@/lib/inventory/validationTypes";

export type { ValidationInput } from "@/lib/inventory/validationContext";
export type { ValidationIssueCode, ValidationSeverity } from "@/lib/inventory/validationTypes";
export type { InvariantSeverity } from "@/lib/inventory/invariants";

export type ValidationVerdict = "PASS" | "PASS_WITH_WARNINGS" | "FAIL";

export type ValidationIssue = Omit<InvariantFinding, "code"> & {
  /** Register id (e.g. "P1"). The join key to invariants.ts. */
  invariant_id: string;
  /** Authoritative three-level severity from the register. */
  severity: InvariantSeverity;
  /** Legacy two-level severity, derived from `severity`. */
  legacy_severity: ValidationSeverity;
  /** Legacy code for back-compat (falls back to the invariant id). */
  code: string;
  message: string;
};

export type ValidationReport = {
  run_at: string;
  environment: string;
  mode: "full" | "incremental";
  summary: {
    // Legacy two-level counts (errors = critical + error).
    errors: number;
    warnings: number;
    products_checked: number;
    lots_checked: number;
    // Three-level counts.
    critical: number;
    error: number;
    warning: number;
  };
  verdict: ValidationVerdict;
  coverage: RegisterCoverage;
  issues: ValidationIssue[];
};

const SEVERITY_RANK: Record<InvariantSeverity, number> = { CRITICAL: 0, ERROR: 1, WARNING: 2 };

function toLegacySeverity(sev: InvariantSeverity): ValidationSeverity {
  return sev === "WARNING" ? "warning" : "error";
}

export function validateInventoryData(
  input: ValidationInput,
  environment = "fixture",
  opts: { mode?: "full" | "incremental" } = {},
): ValidationReport {
  const ctx = buildValidationContext(input);
  const issues: ValidationIssue[] = [];

  for (const invariant of INVARIANTS) {
    if (!invariant.check) continue; // declared but not yet implemented
    for (const finding of invariant.check(ctx)) {
      issues.push({
        ...finding,
        invariant_id: invariant.id,
        severity: invariant.severity,
        legacy_severity: toLegacySeverity(invariant.severity),
        code: finding.code ?? invariant.legacyCode ?? invariant.id,
        message: finding.message,
      });
    }
  }

  // Severity-first (stable) so truncation never hides a CRITICAL (§14).
  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const critical = issues.filter((i) => i.severity === "CRITICAL").length;
  const error = issues.filter((i) => i.severity === "ERROR").length;
  const warning = issues.filter((i) => i.severity === "WARNING").length;

  const verdict: ValidationVerdict =
    critical + error > 0 ? "FAIL" : warning > 0 ? "PASS_WITH_WARNINGS" : "PASS";

  return {
    run_at: new Date().toISOString(),
    environment,
    mode: opts.mode ?? "full",
    summary: {
      errors: critical + error,
      warnings: warning,
      products_checked: input.products.length,
      lots_checked: input.lots.length,
      critical,
      error,
      warning,
    },
    verdict,
    coverage: registerCoverage(),
    issues,
  };
}

export function formatValidationSummary(report: ValidationReport): string {
  const { summary, issues, coverage } = report;
  const lines = [
    `Inventory validation (${report.environment}, ${report.mode}) at ${report.run_at}`,
    `Verdict: ${report.verdict}`,
    `Products: ${summary.products_checked}, Lots: ${summary.lots_checked}`,
    `Critical: ${summary.critical}, Error: ${summary.error}, Warning: ${summary.warning}`,
    `Register coverage: ${coverage.implemented}/${coverage.total} invariants implemented`,
  ];
  if (issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of issues.slice(0, 50)) {
      lines.push(`  [${issue.severity}] ${issue.invariant_id} (${issue.code}): ${issue.message}`);
    }
    if (issues.length > 50) {
      lines.push(`  ... and ${issues.length - 50} more`);
    }
  }
  return lines.join("\n");
}
