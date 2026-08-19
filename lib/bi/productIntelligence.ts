/**
 * Product and stock intelligence: what moves, what sits, what margin each line
 * earns, and how much capital is trapped in stock that is not selling.
 *
 * Per-product inventory value uses FIFO lot balances (`qty_remaining × unit_cost`),
 * the same basis as the dashboard's inventory-at-lot-cost figure, not the product's
 * current cost field.
 */
import type { ProductDoc, SaleDoc, StockLotDoc } from "@/lib/types/firestore";
import { num, timestampToDate, type WithId } from "@/lib/bi/dataset";
import { MS_PER_DAY, startOfLocalDay } from "@/lib/bi/periods";
import { grossMarginPct, markupPct, roundMoney2 } from "@/lib/bi/finance";
import { isReportableSale, saleCogs } from "@/lib/bi/monthlySeries";
import { isProductActive } from "@/lib/products/archive";

/** No sale in this many days, with stock on hand, counts as dead. */
export const DEAD_STOCK_DAYS = 180;
/** More than this many days of cover at the current pace counts as slow-moving. */
export const SLOW_STOCK_COVER_DAYS = 90;
/** A SKU younger than this has too little history to be judged. */
export const MIN_PRODUCT_AGE_DAYS = 45;

export type ProductStockClass = "fast" | "healthy" | "slow" | "dead" | "out_of_stock" | "too_new";

export type ProductIntelRow = {
  productId: string;
  name: string;
  category: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number | null;
  markupPct: number | null;
  unitsSold: number;
  /** Units sold per day across the analysis period. */
  velocityPerDay: number | null;
  stockQuantity: number;
  /** Stock on hand at FIFO lot cost. */
  inventoryValue: number;
  /** Days of stock left at the current selling pace. */
  daysOfCover: number | null;
  daysSinceLastSale: number | null;
  /** Age of the oldest open lot — how long the money has been sitting there. */
  oldestLotAgeDays: number | null;
  productAgeDays: number | null;
  stockClass: ProductStockClass;
  classReason: string;
};

export type CategoryMarginRow = {
  category: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number | null;
  unitsSold: number;
  sharePct: number | null;
  inventoryValue: number;
};

export type StockOutExposureRow = {
  productId: string;
  name: string;
  category: string;
  /** Revenue this product produced per day while it was selling in the period. */
  dailyRevenue: number;
  /** Projected monthly revenue exposure while it stays out of stock. */
  monthlyRevenueExposure: number;
  monthlyGrossProfitExposure: number;
  daysSinceLastSale: number | null;
};

export type StockOutExposure = {
  rows: StockOutExposureRow[];
  productCount: number;
  monthlyRevenueExposure: number;
  monthlyGrossProfitExposure: number;
  /** Exposure as a share of monthly revenue, 0–100. */
  exposureSharePct: number | null;
  sentence: string;
  dataNote: string;
};

export type ProductIntelligence = {
  products: ProductIntelRow[];
  categories: CategoryMarginRow[];
  fastMoving: ProductIntelRow[];
  slowMoving: ProductIntelRow[];
  deadStock: ProductIntelRow[];
  outOfStock: ProductIntelRow[];
  /** Capital sitting in slow-moving and dead stock. */
  capitalTrappedSlow: number;
  capitalTrappedDead: number;
  capitalTrappedTotal: number;
  capitalTrappedSharePct: number | null;
  totalInventoryValue: number;
  highestMargin: ProductIntelRow[];
  lowestMargin: ProductIntelRow[];
  highestGrossProfit: ProductIntelRow[];
  /** Good margin, low volume — worth pushing. */
  goodMarginLowVolume: ProductIntelRow[];
  /** High volume, thin margin — worth repricing or renegotiating, not dropping. */
  highVolumeLowMargin: ProductIntelRow[];
  stockOutExposure: StockOutExposure;
  /** Share of period revenue from the single largest product, 0–100. */
  topProductSharePct: number | null;
  /** Performance per product, for supplier margin attribution. */
  performanceByProduct: Map<string, { revenue: number; grossProfit: number }>;
};

export type ProductIntelligenceInput = {
  products: readonly WithId<ProductDoc>[];
  sales: readonly WithId<SaleDoc>[];
  stockLots: readonly WithId<StockLotDoc>[];
  voidInvoiceIds: ReadonlySet<string>;
  costByProductId: ReadonlyMap<string, number>;
  periodStart: Date;
  periodEnd: Date;
  periodDays: number;
  now: Date;
  /** Monthly revenue at the current run rate, for the exposure share. */
  monthlyRevenue: number;
};

const UNCATEGORIZED = "Uncategorised";

function daysBetween(from: Date | null, to: Date): number | null {
  if (!from) return null;
  const ms = startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime();
  return Math.max(0, Math.floor(ms / MS_PER_DAY));
}

export function buildProductIntelligence(input: ProductIntelligenceInput): ProductIntelligence {
  type Agg = { revenue: number; cogs: number; units: number; lastSale: Date | null };
  const salesByProduct = new Map<string, Agg>();
  /** Last sale at any time in the loaded history — used for dead-stock detection. */
  const lastSaleEver = new Map<string, Date>();

  for (const row of input.sales) {
    if (!isReportableSale(row.data, input.voidInvoiceIds)) continue;
    const date = timestampToDate(row.data.date);
    if (!date) continue;
    const productId = row.data.product_id;
    if (!productId) continue;

    if (row.data.sale_type !== "return") {
      const previous = lastSaleEver.get(productId);
      if (!previous || date > previous) lastSaleEver.set(productId, date);
    }

    if (date < input.periodStart || date > input.periodEnd) continue;

    let agg = salesByProduct.get(productId);
    if (!agg) {
      agg = { revenue: 0, cogs: 0, units: 0, lastSale: null };
      salesByProduct.set(productId, agg);
    }
    agg.revenue += num(row.data.total_amount);
    agg.cogs += saleCogs(row.data, input.costByProductId);
    const qty = num(row.data.quantity);
    agg.units += row.data.sale_type === "return" ? -qty : qty;
    if (row.data.sale_type !== "return" && (!agg.lastSale || date > agg.lastSale)) {
      agg.lastSale = date;
    }
  }

  type LotAgg = { value: number; oldestReceived: Date | null };
  const lotsByProduct = new Map<string, LotAgg>();
  for (const row of input.stockLots) {
    const lot = row.data;
    const remaining = num(lot.qty_remaining);
    if (remaining <= 0) continue;
    const productId = lot.product_id;
    if (!productId) continue;
    let agg = lotsByProduct.get(productId);
    if (!agg) {
      agg = { value: 0, oldestReceived: null };
      lotsByProduct.set(productId, agg);
    }
    agg.value += remaining * num(lot.unit_cost);
    const received = timestampToDate(lot.received_at) ?? timestampToDate(lot.created_at);
    if (received && (!agg.oldestReceived || received < agg.oldestReceived)) {
      agg.oldestReceived = received;
    }
  }

  // Archived products are retired lines — ranking them as slow-moving or dead stock
  // would just be advice to act on something already dealt with.
  const activeProducts = input.products.filter((row) => isProductActive(row.data));

  const products: ProductIntelRow[] = activeProducts.map((row) => {
    const doc = row.data;
    const agg = salesByProduct.get(row.id);
    const lots = lotsByProduct.get(row.id);
    const revenue = roundMoney2(agg?.revenue ?? 0);
    const cogs = roundMoney2(agg?.cogs ?? 0);
    const unitsSold = agg?.units ?? 0;
    const stockQuantity = num(doc.stock_quantity);
    const inventoryValue = roundMoney2(lots?.value ?? 0);
    const velocityPerDay = input.periodDays > 0 && unitsSold > 0 ? unitsSold / input.periodDays : null;
    const daysOfCover =
      velocityPerDay !== null && velocityPerDay > 0 ? stockQuantity / velocityPerDay : null;
    const daysSinceLastSale = daysBetween(lastSaleEver.get(row.id) ?? null, input.now);
    const productAgeDays = daysBetween(timestampToDate(doc.created_at), input.now);
    const oldestLotAgeDays = daysBetween(lots?.oldestReceived ?? null, input.now);

    const { stockClass, classReason } = classifyStock({
      stockQuantity,
      unitsSold,
      daysOfCover,
      daysSinceLastSale,
      productAgeDays,
      hasSalesHistory: lastSaleEver.has(row.id),
    });

    return {
      productId: row.id,
      name: typeof doc.name === "string" && doc.name.trim() ? doc.name.trim() : "(unnamed)",
      category: typeof doc.category === "string" && doc.category.trim() ? doc.category.trim() : UNCATEGORIZED,
      revenue,
      cogs,
      grossProfit: roundMoney2(revenue - cogs),
      marginPct: grossMarginPct(revenue, cogs),
      markupPct: markupPct(revenue, cogs),
      unitsSold,
      velocityPerDay,
      stockQuantity,
      inventoryValue,
      daysOfCover,
      daysSinceLastSale,
      oldestLotAgeDays,
      productAgeDays,
      stockClass,
      classReason,
    };
  });

  const totalRevenue = products.reduce((sum, p) => sum + Math.max(0, p.revenue), 0);
  const totalInventoryValue = roundMoney2(products.reduce((sum, p) => sum + p.inventoryValue, 0));

  const categoryMap = new Map<string, CategoryMarginRow>();
  for (const product of products) {
    let row = categoryMap.get(product.category);
    if (!row) {
      row = {
        category: product.category,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        marginPct: null,
        unitsSold: 0,
        sharePct: null,
        inventoryValue: 0,
      };
      categoryMap.set(product.category, row);
    }
    row.revenue += product.revenue;
    row.cogs += product.cogs;
    row.unitsSold += product.unitsSold;
    row.inventoryValue += product.inventoryValue;
  }
  const categories = [...categoryMap.values()]
    .map((row) => ({
      ...row,
      revenue: roundMoney2(row.revenue),
      cogs: roundMoney2(row.cogs),
      grossProfit: roundMoney2(row.revenue - row.cogs),
      marginPct: grossMarginPct(row.revenue, row.cogs),
      inventoryValue: roundMoney2(row.inventoryValue),
      sharePct: totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : null,
    }))
    .filter((row) => row.revenue !== 0 || row.inventoryValue > 0)
    .sort((a, b) => b.revenue - a.revenue);

  const sold = products.filter((p) => p.revenue > 0);

  const fastMoving = products
    .filter((p) => p.stockClass === "fast")
    .sort((a, b) => (b.velocityPerDay ?? 0) - (a.velocityPerDay ?? 0));
  const slowMoving = products
    .filter((p) => p.stockClass === "slow")
    .sort((a, b) => b.inventoryValue - a.inventoryValue);
  const deadStock = products
    .filter((p) => p.stockClass === "dead")
    .sort((a, b) => b.inventoryValue - a.inventoryValue);
  const outOfStock = products
    .filter((p) => p.stockClass === "out_of_stock")
    .sort((a, b) => b.revenue - a.revenue);

  const capitalTrappedSlow = roundMoney2(slowMoving.reduce((sum, p) => sum + p.inventoryValue, 0));
  const capitalTrappedDead = roundMoney2(deadStock.reduce((sum, p) => sum + p.inventoryValue, 0));
  const capitalTrappedTotal = roundMoney2(capitalTrappedSlow + capitalTrappedDead);

  const medianRevenue = medianOf(sold.map((p) => p.revenue));
  const medianMargin = medianOf(
    sold.map((p) => p.marginPct).filter((m): m is number => m !== null),
  );

  const highestMargin = sold
    .filter((p) => p.marginPct !== null)
    .slice()
    .sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0))
    .slice(0, 8);
  const lowestMargin = sold
    .filter((p) => p.marginPct !== null)
    .slice()
    .sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0))
    .slice(0, 8);
  const highestGrossProfit = sold
    .slice()
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, 8);

  const goodMarginLowVolume =
    medianRevenue === null || medianMargin === null
      ? []
      : sold
          .filter((p) => (p.marginPct ?? 0) > medianMargin && p.revenue < medianRevenue)
          .sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0))
          .slice(0, 8);
  const highVolumeLowMargin =
    medianRevenue === null || medianMargin === null
      ? []
      : sold
          .filter((p) => (p.marginPct ?? 100) < medianMargin && p.revenue > medianRevenue)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 8);

  const stockOutExposure = buildStockOutExposure(outOfStock, input);

  const topProductRevenue = sold.slice().sort((a, b) => b.revenue - a.revenue)[0]?.revenue ?? 0;

  const performanceByProduct = new Map<string, { revenue: number; grossProfit: number }>();
  for (const product of products) {
    if (product.revenue === 0 && product.grossProfit === 0) continue;
    performanceByProduct.set(product.productId, {
      revenue: product.revenue,
      grossProfit: product.grossProfit,
    });
  }

  return {
    products,
    categories,
    fastMoving,
    slowMoving,
    deadStock,
    outOfStock,
    capitalTrappedSlow,
    capitalTrappedDead,
    capitalTrappedTotal,
    capitalTrappedSharePct:
      totalInventoryValue > 0 ? (capitalTrappedTotal / totalInventoryValue) * 100 : null,
    totalInventoryValue,
    highestMargin,
    lowestMargin,
    highestGrossProfit,
    goodMarginLowVolume,
    highVolumeLowMargin,
    stockOutExposure,
    topProductSharePct: totalRevenue > 0 ? (topProductRevenue / totalRevenue) * 100 : null,
    performanceByProduct,
  };
}

function classifyStock(params: {
  stockQuantity: number;
  unitsSold: number;
  daysOfCover: number | null;
  daysSinceLastSale: number | null;
  productAgeDays: number | null;
  hasSalesHistory: boolean;
}): { stockClass: ProductStockClass; classReason: string } {
  const { stockQuantity, unitsSold, daysOfCover, daysSinceLastSale, productAgeDays, hasSalesHistory } = params;

  if (stockQuantity <= 0) {
    return {
      stockClass: "out_of_stock",
      classReason: unitsSold > 0 ? "Sold during this period and is now out of stock." : "No stock on hand.",
    };
  }

  // A young SKU has not had a fair chance to prove itself.
  if (productAgeDays !== null && productAgeDays < MIN_PRODUCT_AGE_DAYS) {
    return {
      stockClass: "too_new",
      classReason: `Added ${productAgeDays} days ago — too new to judge fairly.`,
    };
  }

  if (!hasSalesHistory) {
    return {
      stockClass: "dead",
      classReason: "Stock on hand with no sale recorded in the loaded history.",
    };
  }

  if (daysSinceLastSale !== null && daysSinceLastSale >= DEAD_STOCK_DAYS) {
    return {
      stockClass: "dead",
      classReason: `Last sold ${daysSinceLastSale} days ago, and stock is still on hand.`,
    };
  }

  if (unitsSold <= 0) {
    return {
      stockClass: "slow",
      classReason: "Stock on hand but nothing sold during this period.",
    };
  }

  if (daysOfCover !== null && daysOfCover > SLOW_STOCK_COVER_DAYS) {
    return {
      stockClass: "slow",
      classReason: `About ${Math.round(daysOfCover)} days of stock at the current selling pace.`,
    };
  }

  if (daysOfCover !== null && daysOfCover <= 21) {
    return {
      stockClass: "fast",
      classReason: `Only about ${Math.round(daysOfCover)} days of cover left — selling quickly.`,
    };
  }

  return {
    stockClass: "healthy",
    classReason:
      daysOfCover !== null
        ? `About ${Math.round(daysOfCover)} days of cover at the current pace.`
        : "Selling steadily.",
  };
}

/**
 * Stock-out exposure. TradeBridge does not capture unfulfilled orders or
 * cancelled lines, so this is NOT a record of lost sales — it is what the
 * products currently at zero stock were earning per day while they were
 * available, projected forward for as long as they stay out.
 */
function buildStockOutExposure(
  outOfStock: readonly ProductIntelRow[],
  input: ProductIntelligenceInput,
): StockOutExposure {
  const rows: StockOutExposureRow[] = outOfStock
    .filter((p) => p.revenue > 0 && input.periodDays > 0)
    .map((p) => {
      const dailyRevenue = p.revenue / input.periodDays;
      const monthlyRevenueExposure = dailyRevenue * 30;
      const marginFraction = p.marginPct !== null ? p.marginPct / 100 : 0;
      return {
        productId: p.productId,
        name: p.name,
        category: p.category,
        dailyRevenue: roundMoney2(dailyRevenue),
        monthlyRevenueExposure: roundMoney2(monthlyRevenueExposure),
        monthlyGrossProfitExposure: roundMoney2(monthlyRevenueExposure * marginFraction),
        daysSinceLastSale: p.daysSinceLastSale,
      };
    })
    .sort((a, b) => b.monthlyRevenueExposure - a.monthlyRevenueExposure);

  const monthlyRevenueExposure = roundMoney2(
    rows.reduce((sum, r) => sum + r.monthlyRevenueExposure, 0),
  );
  const monthlyGrossProfitExposure = roundMoney2(
    rows.reduce((sum, r) => sum + r.monthlyGrossProfitExposure, 0),
  );
  const exposureSharePct =
    input.monthlyRevenue > 0 ? (monthlyRevenueExposure / input.monthlyRevenue) * 100 : null;

  return {
    rows,
    productCount: rows.length,
    monthlyRevenueExposure,
    monthlyGrossProfitExposure,
    exposureSharePct,
    sentence:
      rows.length === 0
        ? "No product that sold during this period is currently out of stock."
        : `${rows.length} product${rows.length === 1 ? "" : "s"} that ${rows.length === 1 ? "was" : "were"} selling ${rows.length === 1 ? "is" : "are"} now out of stock. At their own recent pace that is around Rs. ${Math.round(monthlyRevenueExposure).toLocaleString()} of sales and Rs. ${Math.round(monthlyGrossProfitExposure).toLocaleString()} of gross profit a month while they stay empty.`,
    dataNote:
      "TradeBridge does not record unfulfilled orders, cancelled lines or requests for items you did not have, so no historical lost-sale figure exists. This is a forward exposure estimate built only from what these products were actually selling before they ran out. Capturing out-of-stock requests at order entry would turn this into a measured number.",
  };
}

function medianOf(values: readonly number[]): number | null {
  const usable = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (usable.length === 0) return null;
  const mid = Math.floor(usable.length / 2);
  return usable.length % 2 === 0 ? (usable[mid - 1]! + usable[mid]!) / 2 : usable[mid]!;
}

/** Kept for the caller that needs a per-product lot value map. */
export function inventoryValueByProduct(
  stockLots: readonly WithId<StockLotDoc>[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of stockLots) {
    const remaining = num(row.data.qty_remaining);
    if (remaining <= 0) continue;
    const productId = row.data.product_id;
    if (!productId) continue;
    map.set(productId, (map.get(productId) ?? 0) + remaining * num(row.data.unit_cost));
  }
  return map;
}
