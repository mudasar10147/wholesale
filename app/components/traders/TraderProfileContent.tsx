"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProductDoc, StockLotDoc, TraderDoc } from "@/lib/types/firestore";
import { computeTraderPurchaseStats } from "@/lib/inventory/traderPurchaseStats";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { StatCard } from "@/app/components/ui/StatCard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

type LotRow = StockLotDoc & { id: string };

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function TraderProfileContent() {
  const params = useParams<{ traderId: string }>();
  const traderId = typeof params.traderId === "string" ? params.traderId : "";

  const [trader, setTrader] = useState<TraderDoc | null>(null);
  const [traderLoading, setTraderLoading] = useState(true);
  const [traderError, setTraderError] = useState<string | null>(null);

  const [lots, setLots] = useState<LotRow[]>([]);
  const [productNames, setProductNames] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (!traderId) return;
    let cancelled = false;
    setTraderLoading(true);
    void getDoc(doc(getDb(), COLLECTIONS.traders, traderId))
      .then((snap) => {
        if (cancelled) return;
        setTrader(snap.exists() ? (snap.data() as TraderDoc) : null);
        setTraderLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setTraderError(getFirestoreUserMessage(err));
        setTraderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [traderId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(getDb(), COLLECTIONS.stockLots), (snap) => {
      const next: LotRow[] = [];
      snap.forEach((d) => next.push({ id: d.id, ...(d.data() as StockLotDoc) }));
      setLots(next);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(getDb(), COLLECTIONS.products), (snap) => {
      const map = new Map<string, string>();
      snap.forEach((d) => map.set(d.id, (d.data() as ProductDoc).name ?? d.id));
      setProductNames(map);
    });
    return () => unsub();
  }, []);

  const stats = useMemo(
    () => computeTraderPurchaseStats(lots, traderId),
    [lots, traderId],
  );

  if (traderLoading) {
    return <p className="text-sm text-muted-foreground">Loading trader…</p>;
  }
  if (traderError) {
    return (
      <InlineAlert variant="error" className="max-w-lg">
        {traderError}
      </InlineAlert>
    );
  }
  if (!trader) {
    return (
      <div className="space-y-4">
        <InlineAlert variant="error" className="max-w-lg">
          Trader not found. It may have been deleted.
        </InlineAlert>
        <Link href="/traders" className="text-sm text-primary underline-offset-2 hover:underline">
          Back to traders
        </Link>
      </div>
    );
  }

  const productName = (id: string) => productNames.get(id) ?? id;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{trader.name}</h2>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {trader.contact_person ? <span>Contact: {trader.contact_person}</span> : null}
            {trader.phone ? <span>Phone: {trader.phone}</span> : null}
            {trader.city ? <span>City: {trader.city}</span> : null}
            {!trader.is_active ? <span className="text-destructive">Archived</span> : null}
          </div>
          {trader.address ? (
            <p className="mt-1 text-sm text-muted-foreground">{trader.address}</p>
          ) : null}
          {trader.notes ? (
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">{trader.notes}</p>
          ) : null}
        </div>
        <Link href="/traders">
          <Button type="button" variant="outline">
            Back to traders
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Units purchased" value={stats.totalUnitsPurchased.toLocaleString()} />
        <StatCard
          label="Total amount paid"
          value={money(stats.totalAmountPaid)}
          hint="Sum of purchase value (paid at stock-in)"
        />
        <StatCard label="Receipts" value={stats.receiptCount.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Products purchased</CardTitle>
          <CardDescription>What you have bought from this trader, by product.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.byProduct.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchases recorded from this trader yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 font-semibold text-right">Units</th>
                    <th className="px-3 py-2 font-semibold text-right">Value</th>
                    <th className="px-3 py-2 font-semibold text-right">Receipts</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byProduct.map((line) => (
                    <tr key={line.productId} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 text-foreground">
                        <Link
                          href={`/products/${line.productId}`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {productName(line.productId)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.totalQty.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(line.totalValue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.receiptCount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent purchases</CardTitle>
          <CardDescription>Latest stock-in receipts from this trader.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentReceipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No receipts yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 font-semibold text-right">Qty</th>
                    <th className="px-3 py-2 font-semibold text-right">Unit cost</th>
                    <th className="px-3 py-2 font-semibold text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentReceipts.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatDate(r.receivedAt)}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        <Link
                          href={`/products/${r.productId}`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {productName(r.productId)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.qty.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.unitCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.value)}</td>
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
