"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { fetchInvoiceItemsForProduct } from "@/lib/firestore/productInvoiceItemsQuery";
import { fetchSalesForProduct } from "@/lib/firestore/productSalesQuery";
import { fetchStockLotsForProduct } from "@/lib/firestore/stockLotsQuery";
import type { SaleDocRow } from "@/lib/firestore/salesDrilldown";
import type { ProductDoc, StockLotDoc } from "@/lib/types/firestore";
import { computeProductPurchaseStats } from "@/lib/inventory/productPurchaseStats";
import { getSignedProductImageUrl } from "@/lib/upload/productImages";
import { EditProductModal } from "@/app/components/products/EditProductModal";
import { ProductLotsModal } from "@/app/components/products/ProductLotsModal";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { marginPercent, markupPercent } from "@/lib/pricing/metrics";
import { cn } from "@/lib/utils";

type ProductRow = ProductDoc & { id: string };
type LotRow = StockLotDoc & { id: string };

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(ts: Timestamp) {
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

function sortSalesByDateDesc(rows: SaleDocRow[]): SaleDocRow[] {
  return [...rows].sort((a, b) => {
    const ma = a.data.date?.toMillis?.() ?? 0;
    const mb = b.data.date?.toMillis?.() ?? 0;
    return mb - ma;
  });
}

function ProductHeroImage({ row }: { row: ProductRow }) {
  const direct = row.image_url?.trim() ?? "";
  const path = row.image_path?.trim() ?? "";
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [directFailed, setDirectFailed] = useState(false);
  const [signedFailed, setSignedFailed] = useState(false);
  const [signLoading, setSignLoading] = useState(false);
  const [signErr, setSignErr] = useState(false);

  useEffect(() => {
    setDirectFailed(false);
    setSignedFailed(false);
    setSignedUrl(null);
    setSignErr(false);
    setSignLoading(false);
  }, [row.id, row.image_path, row.image_url]);

  useEffect(() => {
    const needSigned = (!direct || directFailed) && Boolean(path) && !signedFailed;
    if (!needSigned) {
      setSignedUrl(null);
      setSignLoading(false);
      return;
    }
    let cancelled = false;
    setSignLoading(true);
    setSignErr(false);
    void getSignedProductImageUrl(path)
      .then((u) => {
        if (!cancelled) {
          setSignedUrl(u);
          setSignErr(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSignedUrl(null);
          setSignErr(true);
        }
      })
      .finally(() => {
        if (!cancelled) setSignLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [direct, directFailed, path, signedFailed]);

  const sharedClass =
    "h-56 w-full max-w-[280px] rounded-xl border border-border bg-surface-muted object-contain p-3 sm:h-64 sm:max-w-xs";

  if (direct && !directFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Firebase/GCS URLs; avoid next/image hostname restrictions
      <img
        src={direct}
        alt={row.name || "Product"}
        width={280}
        height={280}
        className={sharedClass}
        onError={() => setDirectFailed(true)}
      />
    );
  }
  if (signedUrl && !signedFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed read URL
      <img
        src={signedUrl}
        alt={row.name || "Product"}
        width={280}
        height={280}
        className={sharedClass}
        onError={() => setSignedFailed(true)}
      />
    );
  }
  if (path && signLoading) {
    return (
      <div className="flex h-56 w-full max-w-[280px] items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted text-sm text-muted-foreground sm:h-64">
        Loading image…
      </div>
    );
  }
  if (path && signErr && !signLoading) {
    return (
      <div className="flex h-56 w-full max-w-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-muted px-4 text-center text-sm text-muted-foreground sm:h-64">
        <span>Could not load image (signed URL failed).</span>
        <span className="text-xs">Try re-uploading the photo on the Products page.</span>
      </div>
    );
  }
  return (
    <div className="flex h-56 w-full max-w-[280px] items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted text-sm text-muted-foreground sm:h-64">
      No image
    </div>
  );
}

export function ProductProfileContent() {
  const params = useParams();
  const rawId = params.productId;
  const productId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? (rawId[0] ?? "") : "";

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [sales, setSales] = useState<SaleDocRow[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [invoiceLines, setInvoiceLines] = useState(0);
  const [invoiceQty, setInvoiceQty] = useState(0);
  const [invoiceLineTotal, setInvoiceLineTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showLots, setShowLots] = useState(false);

  const loadProfile = useCallback(
    async (opts?: { soft?: boolean }) => {
      const showSpinner = !opts?.soft;
      if (!productId) {
        setLoading(false);
        setMissing(true);
        return;
      }
      if (showSpinner) {
        setLoading(true);
      }
      setError(null);
      setMissing(false);
      try {
        const db = getDb();
        const [productSnap, saleRows, lotRows, invRows] = await Promise.all([
          getDoc(doc(db, COLLECTIONS.products, productId)),
          fetchSalesForProduct(db, productId),
          fetchStockLotsForProduct(db, productId),
          fetchInvoiceItemsForProduct(db, productId),
        ]);
        if (!productSnap.exists()) {
          setProduct(null);
          setMissing(true);
          setSales([]);
          setLots([]);
          setInvoiceLines(0);
          setInvoiceQty(0);
          setInvoiceLineTotal(0);
          return;
        }
        const d = productSnap.data() as ProductDoc;
        setProduct({ id: productSnap.id, ...d });
        setSales(sortSalesByDateDesc(saleRows));
        setLots(
          lotRows.map((r) => ({
            id: r.id,
            ...r.data,
          })),
        );
        let invQ = 0;
        let lineTot = 0;
        for (const { data } of invRows) {
          invQ += typeof data.quantity === "number" ? data.quantity : 0;
          lineTot += typeof data.line_total === "number" ? data.line_total : 0;
        }
        setInvoiceLines(invRows.length);
        setInvoiceQty(invQ);
        setInvoiceLineTotal(lineTot);
      } catch (e) {
        setError(getFirestoreUserMessage(e));
      } finally {
        if (showSpinner) {
          setLoading(false);
        }
      }
    },
    [productId],
  );

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const analytics = useMemo(() => {
    if (!product) {
      return {
        saleCount: 0,
        totalUnits: 0,
        totalRevenue: 0,
        cogsAtRecordOrCurrent: 0,
        grossProfit: 0,
        lastSaleLabel: "—" as string,
      };
    }
    const costNow = typeof product.cost_price === "number" ? product.cost_price : 0;
    let totalUnits = 0;
    let totalRevenue = 0;
    let cogs = 0;
    let lastTs = 0;
    for (const { data } of sales) {
      const qty = typeof data.quantity === "number" ? data.quantity : 0;
      const rev = typeof data.total_amount === "number" ? data.total_amount : 0;
      const unitCost =
        typeof data.unit_cost === "number" && Number.isFinite(data.unit_cost) ? data.unit_cost : costNow;
      totalUnits += qty;
      totalRevenue += rev;
      cogs += unitCost * qty;
      const ms = data.date?.toMillis?.() ?? 0;
      if (ms > lastTs) lastTs = ms;
    }
    const lastSaleLabel =
      lastTs > 0
        ? new Date(lastTs).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "—";
    return {
      saleCount: sales.length,
      totalUnits,
      totalRevenue,
      cogsAtRecordOrCurrent: cogs,
      grossProfit: totalRevenue - cogs,
      lastSaleLabel,
    };
  }, [product, sales]);

  const lotSummary = useMemo(() => {
    let qtyRemaining = 0;
    let valueAtCost = 0;
    for (const lot of lots) {
      const qr = typeof lot.qty_remaining === "number" ? lot.qty_remaining : 0;
      const uc = typeof lot.unit_cost === "number" ? lot.unit_cost : 0;
      qtyRemaining += qr;
      valueAtCost += qr * uc;
    }
    const stock = product && typeof product.stock_quantity === "number" ? product.stock_quantity : 0;
    return {
      lotCount: lots.length,
      qtyRemaining,
      valueAtCost,
      stockBook: stock,
      lotVsBookDelta: qtyRemaining - stock,
    };
  }, [lots, product]);

  const purchaseStats = useMemo(() => computeProductPurchaseStats(lots), [lots]);

  const marginPct = useMemo(() => {
    if (!product) return null;
    const cost = typeof product.cost_price === "number" ? product.cost_price : 0;
    const sale = typeof product.sale_price === "number" ? product.sale_price : 0;
    return marginPercent(sale, cost);
  }, [product]);

  const markupPct = useMemo(() => {
    if (!product) return null;
    const cost = typeof product.cost_price === "number" ? product.cost_price : 0;
    const sale = typeof product.sale_price === "number" ? product.sale_price : 0;
    return markupPercent(sale, cost);
  }, [product]);

  const stockValueAtCost = useMemo(() => {
    if (!product) return 0;
    const cost = typeof product.cost_price === "number" ? product.cost_price : 0;
    const stock = typeof product.stock_quantity === "number" ? product.stock_quantity : 0;
    return cost * stock;
  }, [product]);

  if (!productId) {
    return (
      <InlineAlert variant="error" className="text-sm">
        Invalid product link.
      </InlineAlert>
    );
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading product…
      </p>
    );
  }

  if (error) {
    return (
      <InlineAlert variant="error" className="text-sm">
        {error}
      </InlineAlert>
    );
  }

  if (missing || !product) {
    return (
      <div className="space-y-4">
        <InlineAlert variant="error" className="text-sm">
          This product was not found. It may have been removed.
        </InlineAlert>
        <Link
          href="/products"
          className={cn(
            "inline-flex w-full items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2.5 text-center text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-surface-hover sm:w-auto",
          )}
        >
          Back to products
        </Link>
      </div>
    );
  }

  const recentSales = sales.slice(0, 40);

  return (
    <div className="space-y-8">
      {editing ? (
        <EditProductModal
          row={product}
          onDismiss={() => {
            setEditing(false);
            void loadProfile({ soft: true });
          }}
        />
      ) : null}

      {showLots ? (
        <ProductLotsModal row={product} onDismiss={() => setShowLots(false)} />
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Link
          href="/products"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          ← Back to products
        </Link>
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setEditing(true)}>
          Edit details
        </Button>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="shrink-0">
          <ProductHeroImage row={product} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{product.name}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Category:</span> {product.category?.trim() || "—"}
          </p>
          <p className="font-mono text-xs text-muted-foreground">ID: {product.id}</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Added:</span> {formatDate(product.created_at)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cost price</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold tabular-nums">{formatMoney(product.cost_price)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sale price</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold tabular-nums">{formatMoney(product.sale_price)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Stock on hand</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold tabular-nums">
            {product.stock_quantity.toLocaleString()} units
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">List margin %</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold tabular-nums">
            {marginPct !== null ? `${marginPct.toFixed(1)}%` : "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">List markup %</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold tabular-nums">
            {markupPct !== null ? `${markupPct.toFixed(1)}%` : "—"}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Purchases</CardTitle>
            <CardDescription>
              Stock-in receipts for this product (where and when it was bought).
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => setShowLots(true)}
          >
            View all lots
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface-muted/40 px-4 py-3">
              <p className="text-sm text-muted-foreground">Units purchased</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {purchaseStats.totalUnitsPurchased.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface-muted/40 px-4 py-3">
              <p className="text-sm text-muted-foreground">Total purchase value</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatMoney(purchaseStats.totalPurchaseValue)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface-muted/40 px-4 py-3">
              <p className="text-sm text-muted-foreground">Receipts</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{purchaseStats.receiptCount}</p>
            </div>
          </div>

          {purchaseStats.recentReceipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No stock-in purchases recorded yet. Opening balances and adjustments are not counted here.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 font-semibold">Shop</th>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Qty</th>
                    <th className="px-3 py-2 font-semibold">Unit cost</th>
                    <th className="px-3 py-2 font-semibold">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseStats.recentReceipts.map((receipt, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 text-foreground">{receipt.source}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {receipt.receivedAt
                          ? receipt.receivedAt.toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })
                          : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{receipt.qty.toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(receipt.unitCost)}</td>
                      <td className="px-3 py-2 tabular-nums font-medium">{formatMoney(receipt.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sales analytics</CardTitle>
            <CardDescription>All recorded sales lines for this product in Firestore.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Sale lines</span>
              <span className="font-medium tabular-nums">{analytics.saleCount}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Units sold (total)</span>
              <span className="font-medium tabular-nums">{analytics.totalUnits.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Revenue (sum of line totals)</span>
              <span className="font-medium tabular-nums">{formatMoney(analytics.totalRevenue)}</span>
            </div>
            <div className="border-b border-border py-2">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Est. COGS</span>
                <span className="shrink-0 font-medium tabular-nums">{formatMoney(analytics.cogsAtRecordOrCurrent)}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Uses <code className="rounded bg-surface-muted px-1">unit_cost</code> on each sale when present,
                otherwise today&apos;s cost price.
              </p>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Est. gross profit</span>
              <span className="font-medium tabular-nums">{formatMoney(analytics.grossProfit)}</span>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <span className="text-muted-foreground">Last sale</span>
              <span className="text-right font-medium">{analytics.lastSaleLabel}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory & invoices</CardTitle>
            <CardDescription>FIFO lots, book stock, and invoice lines referencing this product.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Stock lots</span>
              <span className="font-medium tabular-nums">{lotSummary.lotCount}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Qty remaining (lots)</span>
              <span className="font-medium tabular-nums">{lotSummary.qtyRemaining.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Book stock (product)</span>
              <span className="font-medium tabular-nums">{lotSummary.stockBook.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Lots − book (gap)</span>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  lotSummary.lotVsBookDelta !== 0 ? "text-amber-700 dark:text-amber-400" : "",
                )}
              >
                {lotSummary.lotVsBookDelta === 0 ? "0" : lotSummary.lotVsBookDelta > 0 ? `+${lotSummary.lotVsBookDelta}` : `${lotSummary.lotVsBookDelta}`}
              </span>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Inventory value at lot cost</span>
              <span className="font-medium tabular-nums">{formatMoney(lotSummary.valueAtCost)}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Inventory value at book cost</span>
              <span className="font-medium tabular-nums">{formatMoney(stockValueAtCost)}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Invoice line items</span>
              <span className="font-medium tabular-nums">{invoiceLines}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-border py-2">
              <span className="text-muted-foreground">Qty on invoice lines (sum)</span>
              <span className="font-medium tabular-nums">{invoiceQty.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <span className="text-muted-foreground">Line totals sum (invoices)</span>
              <span className="font-medium tabular-nums">{formatMoney(invoiceLineTotal)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent sales</CardTitle>
          <CardDescription>Up to 40 most recent lines, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentSales.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sales recorded for this product yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Qty</th>
                    <th className="px-3 py-2 font-semibold">Unit price</th>
                    <th className="px-3 py-2 font-semibold">Total</th>
                    <th className="px-3 py-2 font-semibold">Refs</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map(({ id, data }) => (
                    <tr key={id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(data.date)}</td>
                      <td className="px-3 py-2 tabular-nums">{data.quantity}</td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(data.sale_price)}</td>
                      <td className="px-3 py-2 tabular-nums font-medium">{formatMoney(data.total_amount)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {[data.order_id ? `Order ${data.order_id}` : null, data.invoice_id ? `Inv ${data.invoice_id}` : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
