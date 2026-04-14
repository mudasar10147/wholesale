import type { StockLotDoc } from "@/lib/types/firestore";

export type LotCostRow = { qty_remaining: number; unit_cost: number };

/**
 * Weighted average unit cost over remaining quantities (0 when no positive qty rows).
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
 * Product list cost after FIFO stock-out patches (qty_remaining only; unit_cost unchanged per lot).
 */
export function costPriceAfterFifoStockOutLots(
  lots: Array<{ id: string; data: StockLotDoc }>,
  lotUpdates: Array<{ id: string; qty_remaining: number }>,
): number {
  const patch = new Map(lotUpdates.map((u) => [u.id, u.qty_remaining]));
  const rows: LotCostRow[] = [];
  for (const lot of lots) {
    const finalQty = patch.has(lot.id)
      ? patch.get(lot.id)!
      : typeof lot.data.qty_remaining === "number"
        ? lot.data.qty_remaining
        : 0;
    const unitCost =
      typeof lot.data.unit_cost === "number" && Number.isFinite(lot.data.unit_cost)
        ? lot.data.unit_cost
        : 0;
    rows.push({ qty_remaining: finalQty, unit_cost: unitCost });
  }
  return weightedAverageUnitCostFromLotCostRows(rows);
}
