import type { StockLotDoc } from "@/lib/types/firestore";

export type LotCostRow = { qty_remaining: number; unit_cost: number };

export type ProductLotPatch = {
  id: string;
  qty_remaining: number;
  unit_cost?: number;
};

/**
 * Weighted average unit cost over remaining quantities (0 when no positive qty rows).
 * Used for inventory valuation reports — not for product list `cost_price`.
 */
export function weightedAverageUnitCostFromLotCostRows(rows: LotCostRow[]): number {
  let qtySum = 0;
  let valueSum = 0;
  for (const r of rows) {
    const q = r.qty_remaining;
    if (typeof q !== "number" || !Number.isInteger(q) || q <= 0) continue;
    const c =
      typeof r.unit_cost === "number" && Number.isFinite(r.unit_cost) && r.unit_cost >= 0
        ? r.unit_cost
        : 0;
    qtySum += q;
    valueSum += q * c;
  }
  if (qtySum <= 0) return 0;
  return valueSum / qtySum;
}

/**
 * Product list `cost_price`: unit_cost of the most recently received lot that still has stock.
 * Matches "last purchase price" while that batch has quantity left.
 * FIFO sales/discards still use each lot's own unit_cost — this is display/reference only.
 */
export function listCostFromProductLots(
  lots: Array<{ id: string; data: StockLotDoc }>,
  lotPatches: ProductLotPatch[] = [],
): number {
  const patch = new Map(lotPatches.map((u) => [u.id, u]));
  let newest: { receivedAtMs: number; unitCost: number } | null = null;

  for (const lot of lots) {
    const p = patch.get(lot.id);
    const finalQty = p
      ? p.qty_remaining
      : typeof lot.data.qty_remaining === "number"
        ? lot.data.qty_remaining
        : 0;
    if (finalQty <= 0) continue;

    const receivedAtMs = lot.data.received_at?.toMillis?.() ?? 0;
    const unitCost =
      p?.unit_cost !== undefined
        ? p.unit_cost
        : typeof lot.data.unit_cost === "number" &&
            Number.isFinite(lot.data.unit_cost) &&
            lot.data.unit_cost >= 0
          ? lot.data.unit_cost
          : 0;

    if (!newest || receivedAtMs > newest.receivedAtMs) {
      newest = { receivedAtMs, unitCost };
    }
  }

  return newest?.unitCost ?? 0;
}

/** @deprecated Use {@link listCostFromProductLots} — list cost is not a weighted average. */
export function costPriceAfterFifoStockOutLots(
  lots: Array<{ id: string; data: StockLotDoc }>,
  lotUpdates: Array<{ id: string; qty_remaining: number }>,
): number {
  return listCostFromProductLots(
    lots,
    lotUpdates.map((u) => ({ id: u.id, qty_remaining: u.qty_remaining })),
  );
}

/** @deprecated Use {@link listCostFromProductLots}. */
export function costPriceFromNewestLotWithStock(
  lots: Array<{ id: string; data: StockLotDoc }>,
  lotUpdates: Array<{ id: string; qty_remaining: number }>,
): number {
  return listCostFromProductLots(
    lots,
    lotUpdates.map((u) => ({ id: u.id, qty_remaining: u.qty_remaining })),
  );
}
