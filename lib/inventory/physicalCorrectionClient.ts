/**
 * Client for the Physical Stock Correction admin tool. Attaches the caller's Firebase
 * ID token and talks to `/api/inventory/stock-correction`. Recent-history reads go
 * straight to Firestore (admin-gated by rules).
 */
import {
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
} from "firebase/firestore";
import { getAuthClient, getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type {
  PhysicalCorrectionCostSource,
  PhysicalCorrectionValidation,
  PhysicalStockCorrectionDoc,
} from "@/lib/types/firestore";

const ENDPOINT = "/api/inventory/stock-correction";

export type ProductSearchHit = {
  id: string;
  name: string;
  sku: string;
  image_url: string | null;
  stock_quantity: number;
};

export type OpenLotView = {
  id: string;
  qty_remaining: number;
  unit_cost: number;
  source: string;
  received_at: string | null;
};

export type CorrectionPreview = {
  status: "ok";
  product: {
    id: string;
    name: string;
    sku: string;
    barcode: string | null;
    image_url: string | null;
    stock_quantity: number;
    cost_price: number;
  };
  open_lots: OpenLotView[];
  before_lot_total: number;
  resolved_unit_cost: number | null;
  cost_source: PhysicalCorrectionCostSource | null;
};

export type CorrectionSummary = {
  correction_id: string;
  product_id: string;
  before_book_stock: number;
  before_lot_total: number;
  physical_count: number;
  stock_delta: number;
  closed_lots: Array<{ lot_id: string; qty_remaining_before: number }>;
  new_lot_id: string | null;
  unit_cost: number;
  cost_source: PhysicalCorrectionCostSource;
  ledger_transaction_id: string;
  post_update_validation: PhysicalCorrectionValidation;
};

export type ApplyCorrectionResult =
  | { status: "applied"; correction: CorrectionSummary }
  | { status: "already_applied"; correction: CorrectionSummary }
  | { status: "not_found" }
  | { status: "invalid_count"; message: string }
  | { status: "cost_required"; message: string }
  | { status: "stale_preview"; message: string; current_stock: number; current_open_lot_total: number }
  | { status: "error"; message: string };

async function authHeaders(): Promise<Record<string, string>> {
  const user = getAuthClient().currentUser;
  if (!user) throw new Error("Please sign in again.");
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** POST helper that parses via text()+JSON.parse (Safari-safe on HTML error pages). */
async function post<T>(body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: "Unexpected server response." };
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

export type WorksheetRow = {
  id: string;
  name: string;
  sku: string;
  image_url: string | null;
  stock_quantity: number;
  open_lot_total: number;
  resolved_unit_cost: number | null;
  cost_source: PhysicalCorrectionCostSource | null;
};

export async function loadWorksheet(): Promise<WorksheetRow[]> {
  const { data } = await post<{ rows?: WorksheetRow[]; error?: string }>({ action: "worksheet" });
  return data.rows ?? [];
}

export async function searchProducts(q: string): Promise<ProductSearchHit[]> {
  const { data } = await post<{ hits?: ProductSearchHit[]; error?: string }>({
    action: "search",
    query: q,
  });
  return data.hits ?? [];
}

export async function previewCorrection(
  productId: string,
): Promise<CorrectionPreview | { status: "error"; message: string }> {
  const { ok, data } = await post<CorrectionPreview & { error?: string }>({
    action: "preview",
    productId,
  });
  if (!ok || data.status !== "ok") {
    return { status: "error", message: data.error ?? "Could not load the product." };
  }
  return data;
}

export type ApplyCorrectionInput = {
  productId: string;
  physicalCount: number;
  manualUnitCost?: number | null;
  reason: string;
  recountSessionId: string;
  idempotencyKey: string;
  expectedCurrentStock: number;
  expectedOpenLotTotal: number;
};

export async function applyCorrection(input: ApplyCorrectionInput): Promise<ApplyCorrectionResult> {
  const { data } = await post<ApplyCorrectionResult & { error?: string }>({
    action: "apply",
    ...input,
  });
  if ("error" in data && data.error) {
    return { status: "error", message: data.error };
  }
  return data;
}

export type RecentCorrection = {
  id: string;
  product_id: string;
  product_name: string;
  physical_count: number;
  stock_delta: number;
  cost_source: PhysicalCorrectionCostSource;
  operator_email: string;
  created_at: string | null;
  ok: boolean;
};

export async function loadRecentCorrections(max = 25): Promise<RecentCorrection[]> {
  const snap = await getDocs(
    query(
      collection(getDb(), COLLECTIONS.physicalStockCorrections),
      orderBy("created_at", "desc"),
      fbLimit(max),
    ),
  );
  return snap.docs.map((d) => {
    const data = d.data() as PhysicalStockCorrectionDoc & {
      created_at?: { toDate?: () => Date };
    };
    return {
      id: d.id,
      product_id: data.product_id ?? "",
      product_name: data.product_name ?? "",
      physical_count: typeof data.physical_count === "number" ? data.physical_count : 0,
      stock_delta: typeof data.stock_delta === "number" ? data.stock_delta : 0,
      cost_source: data.cost_source ?? "manual",
      operator_email: data.operator_email ?? "",
      created_at:
        typeof data.created_at?.toDate === "function" ? data.created_at.toDate().toISOString() : null,
      ok: data.post_update_validation?.ok ?? true,
    };
  });
}

/** Stable idempotency key per confirmed submission; new key only on a fresh confirm. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `corr-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
