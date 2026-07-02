"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { CreateReturnLineModal } from "@/app/components/customers/CreateReturnLineModal";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { SearchableSelect, type SearchableOption } from "@/app/components/ui/SearchableSelect";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  fetchCustomerPurchaseLines,
  type CustomerPurchaseLine,
} from "@/lib/firestore/customerPurchaseHistory";
import type { CustomerDoc } from "@/lib/types/firestore";
import { cn } from "@/lib/utils";

type CustomerRow = CustomerDoc & { id: string };

type CustomerOption = SearchableOption & { row: CustomerRow };

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(line: CustomerPurchaseLine): string {
  if (!line.invoiceDate) return "—";
  try {
    return line.invoiceDate.toDate().toLocaleDateString();
  } catch {
    return "—";
  }
}

export function CustomerPurchaseReturnPanel() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [customerId, setCustomerId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showFullyReturned, setShowFullyReturned] = useState(false);
  const [lines, setLines] = useState<CustomerPurchaseLine[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingLines, setLoadingLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnLine, setReturnLine] = useState<CustomerPurchaseLine | null>(null);

  useEffect(() => {
    const db = getDb();
    const unsubCustomers = onSnapshot(
      collection(db, COLLECTIONS.customers),
      (snap) => {
        setLoadingCustomers(false);
        const next: CustomerRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as CustomerDoc) }));
        next.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));
        setCustomers(next);
      },
      (err) => {
        setLoadingCustomers(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    const unsubProducts = onSnapshot(collection(db, COLLECTIONS.products), (snap) => {
      const map = new Map<string, string>();
      snap.forEach((d) => {
        const name = (d.data().name as string | undefined)?.trim();
        map.set(d.id, name || d.id);
      });
      setProductNames(map);
    });
    return () => {
      unsubCustomers();
      unsubProducts();
    };
  }, []);

  useEffect(() => {
    if (!customerId) {
      setLines([]);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingLines(true);
      setError(null);
      try {
        const next = await fetchCustomerPurchaseLines(getDb(), customerId);
        if (!cancelled) setLines(next);
      } catch (err) {
        if (!cancelled) setError(getFirestoreUserMessage(err));
      } finally {
        if (!cancelled) setLoadingLines(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const customerOptions = useMemo<CustomerOption[]>(
    () =>
      customers
        .filter((c) => c.is_active)
        .map((row) => ({
          id: row.id,
          row,
          searchText: [row.name, row.phone, row.email].filter(Boolean).join(" ").toLowerCase(),
        })),
    [customers],
  );

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId],
  );

  const filteredLines = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return lines.filter((line) => {
      if (!showFullyReturned && line.returnableQuantity <= 0) return false;
      if (!q) return true;
      const productName = (productNames.get(line.productId) ?? line.productId).toLowerCase();
      const orderId = line.orderId.toLowerCase();
      return productName.includes(q) || orderId.includes(q);
    });
  }, [lines, productSearch, productNames, showFullyReturned]);

  return (
    <div className="space-y-4">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Customer</Label>
          <SearchableSelect
            options={customerOptions}
            value={customerId}
            onChange={setCustomerId}
            getDisplayValue={(o) => o.row.name}
            renderOption={(o) => (
              <span>
                {o.row.name}
                {o.row.phone ? (
                  <span className="text-muted-foreground"> · {o.row.phone}</span>
                ) : null}
              </span>
            )}
            placeholder={loadingCustomers ? "Loading customers…" : "Search customer…"}
            emptyText="No customers found."
            disabled={loadingCustomers}
            ariaLabel="Customer for return"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="purchase-product-search">Search product or invoice</Label>
          <Input
            id="purchase-product-search"
            type="search"
            placeholder="Product name or invoice number"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            disabled={!customerId}
          />
        </div>
      </div>

      {customerId ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowFullyReturned((v) => !v)}
            aria-pressed={showFullyReturned}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              showFullyReturned
                ? "border-foreground bg-surface-hover text-foreground"
                : "border-border text-muted-foreground hover:bg-surface-hover",
            )}
          >
            Show fully returned
          </button>
          <span className="text-sm text-muted-foreground">
            {loadingLines
              ? "Loading purchase history…"
              : `${filteredLines.length} line${filteredLines.length === 1 ? "" : "s"} shown`}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a customer to see everything they have purchased on posted invoices.
        </p>
      )}

      {customerId && !loadingLines && filteredLines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {lines.length === 0
            ? "No posted purchases for this customer yet."
            : "No lines match your search. Try another product name or invoice number."}
        </p>
      ) : null}

      {filteredLines.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[920px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-3 font-semibold text-foreground">Product</th>
                <th className="px-4 py-3 font-semibold text-foreground">Invoice</th>
                <th className="px-4 py-3 font-semibold text-foreground">Date</th>
                <th className="px-4 py-3 font-semibold text-foreground text-right">Sold</th>
                <th className="px-4 py-3 font-semibold text-foreground text-right">Returned</th>
                <th className="px-4 py-3 font-semibold text-foreground text-right">Returnable</th>
                <th className="px-4 py-3 font-semibold text-foreground text-right">Unit price</th>
                <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLines.map((line, i) => {
                const productName = productNames.get(line.productId) ?? line.productId;
                const canReturn = line.returnableQuantity > 0;
                return (
                  <tr
                    key={line.invoiceItemId}
                    className={cn(
                      "border-b border-border last:border-b-0 align-top",
                      i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{productName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{line.orderId}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(line)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{line.soldQuantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{line.alreadyReturned}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {canReturn ? (
                        <span className="font-medium text-foreground">{line.returnableQuantity}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(line.unitPrice)}</td>
                    <td className="px-4 py-3">
                      {canReturn ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setReturnLine(line)}
                        >
                          Create return
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Fully returned</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {returnLine && selectedCustomer ? (
        <CreateReturnLineModal
          line={returnLine}
          customerName={selectedCustomer.name}
          productName={productNames.get(returnLine.productId) ?? returnLine.productId}
          onDismiss={() => setReturnLine(null)}
        />
      ) : null}
    </div>
  );
}
