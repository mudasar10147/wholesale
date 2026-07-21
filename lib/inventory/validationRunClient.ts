"use client";

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { getAuthClient } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";

export type RunSeverity = "CRITICAL" | "ERROR" | "WARNING";

export type ClientRunIssue = {
  invariant_id: string;
  severity: RunSeverity;
  entity_type: string;
  entity_id: string;
  first_seen_at?: Timestamp;
};

export type ClientValidationRun = {
  run_id: string;
  mode: "full" | "incremental";
  verdict: "PASS" | "PASS_WITH_WARNINGS" | "FAIL";
  complete: boolean;
  started_at?: Timestamp;
  summary: { critical: number; error: number; warning: number };
  counts: { products: number; lots: number; consumptions: number; invoices: number; ledger_transactions: number };
  issues: ClientRunIssue[];
  truncated?: boolean;
  issues_total?: number;
  scope?: { product_ids: string[] };
};

export type TriggerResponse =
  | { status: "started"; record: { run_id: string; verdict: string } }
  | { status: "in_progress"; run_id: string | null }
  | { status: "rate_limited"; retry_after_seconds: number; message: string }
  | { status: "error"; message: string };

/** Read the most recent persisted validation run (admin-readable). */
export async function loadLatestValidationRun(db: Firestore): Promise<ClientValidationRun | null> {
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.inventoryValidationRuns), orderBy("started_at", "desc"), limit(1)),
  );
  const doc = snap.docs[0];
  return doc ? (doc.data() as ClientValidationRun) : null;
}

/** Trigger an on-demand validation run (admin-only, enforced server-side). */
export async function triggerValidationRun(mode: "full" | "incremental"): Promise<TriggerResponse> {
  const user = getAuthClient().currentUser;
  if (!user) return { status: "error", message: "Please sign in again." };
  const token = await user.getIdToken();
  const res = await fetch("/api/inventory/validate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  const text = (await res.text()).trim();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    return { status: "error", message: `Unexpected response (${res.status}).` };
  }
  if (!res.ok && res.status !== 429) {
    return { status: "error", message: (parsed.error as string) || `Validation failed (${res.status}).` };
  }
  return parsed as TriggerResponse;
}
