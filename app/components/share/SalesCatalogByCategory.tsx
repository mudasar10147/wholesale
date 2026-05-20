"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { downloadCatalogPdf, type CatalogPdfOptionalColumn } from "@/lib/share/salesCatalogPdf";
import { SalesCatalogPdfModal } from "@/app/components/share/SalesCatalogPdfModal";
import type { ProductDoc } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

type ProductRow = ProductDoc & { id: string };
type GroupedProducts = Record<string, ProductRow[]>;

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function SalesCatalogByCategory() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);

  useEffect(() => {
    const db = getDb();
    const productsQuery = query(collection(db, COLLECTIONS.products));

    const unsubscribe = onSnapshot(
      productsQuery,
      (snapshot) => {
        const nextRows: ProductRow[] = [];
        snapshot.forEach((docSnapshot) => {
          nextRows.push({
            id: docSnapshot.id,
            ...(docSnapshot.data() as ProductDoc),
          });
        });
        setRows(nextRows);
        setLoading(false);
        setError(null);
        setUpdatedAt(new Date());
      },
      (snapshotError) => {
        setLoading(false);
        setError(getFirestoreUserMessage(snapshotError));
      },
    );

    return () => unsubscribe();
  }, []);

  const filteredRows = useMemo(() => {
    const queryValue = searchQuery.trim().toLowerCase();
    if (!queryValue) {
      return rows;
    }

    return rows.filter((row) => {
      const name = row.name.toLowerCase();
      const category = (row.category ?? "").toLowerCase();
      return name.includes(queryValue) || category.includes(queryValue);
    });
  }, [rows, searchQuery]);

  const groupedProducts = useMemo(() => {
    const groups: GroupedProducts = {};

    for (const product of filteredRows) {
      const normalizedCategory = product.category?.trim() || "Uncategorized";
      if (!groups[normalizedCategory]) {
        groups[normalizedCategory] = [];
      }
      groups[normalizedCategory].push(product);
    }

    const sortedCategories = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    const sortedGroups: GroupedProducts = {};
    for (const category of sortedCategories) {
      sortedGroups[category] = groups[category]!.slice().sort((a, b) => a.name.localeCompare(b.name));
    }

    return sortedGroups;
  }, [filteredRows]);

  async function handleDownloadPdfConfirm(columns: CatalogPdfOptionalColumn[]) {
    if (filteredRows.length === 0 || pdfPending) return;
    setPdfPending(true);
    try {
      await downloadCatalogPdf(filteredRows, { columns });
      setPdfModalOpen(false);
    } catch (downloadError) {
      setError(getFirestoreUserMessage(downloadError));
    } finally {
      setPdfPending(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading products...
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No products are available right now.</p>;
  }

  const categories = Object.entries(groupedProducts);
  const searchId = "sales-catalog-search";

  return (
    <div className="space-y-5">
      <SalesCatalogPdfModal
        open={pdfModalOpen}
        onClose={() => setPdfModalOpen(false)}
        onConfirm={(columns) => void handleDownloadPdfConfirm(columns)}
        pending={pdfPending}
      />
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-md flex-1 space-y-1.5">
            <Label htmlFor={searchId}>Search products</Label>
            <Input
              id={searchId}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Name or category"
              autoComplete="off"
            />
          </div>
          <Button
            type="button"
            onClick={() => setPdfModalOpen(true)}
            disabled={pdfPending || filteredRows.length === 0}
          >
            Download PDF
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {updatedAt ? `Last updated: ${updatedAt.toLocaleString()}` : "Waiting for updates..."}
        </p>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No products match {`"${searchQuery.trim()}"`}. Try a different search.
        </p>
      ) : (
        categories.map(([category, products]) => (
          <section key={category} className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">
              {category} ({products.length})
            </h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] table-fixed border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-[46%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-4 py-3 font-semibold text-foreground">Product</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Purchase price</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Sale price</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Quantity left</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, index) => (
                    <tr key={product.id} className={index % 2 === 0 ? "bg-surface" : "bg-surface-muted/50"}>
                      <td className="px-4 py-3 font-medium text-foreground">{product.name}</td>
                      <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(product.cost_price)}</td>
                      <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(product.sale_price)}</td>
                      <td className="px-4 py-3 tabular-nums text-foreground">
                        {product.stock_quantity.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
