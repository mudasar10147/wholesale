"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  approveWalkInSession,
  createWalkInSession,
  deleteApprovedWalkInSession,
  deletePendingWalkInSession,
  fetchWalkInLines,
  markApprovedWalkInSessionPaid,
  rejectWalkInSession,
  replaceWalkInSessionContent,
  startOfLocalDay,
  type WalkInLineInput,
} from "@/lib/firestore/walkInSessions";
import type { ProductDoc, WalkInSessionDoc } from "@/lib/types/firestore";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { SearchableSelect } from "@/app/components/ui/SearchableSelect";

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInput(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

type ProductOption = {
  id: string;
  name: string;
  sale_price: number;
  stock_quantity: number;
  searchText: string;
};

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type LineForm = { productId: string; quantity: string; unitSalePrice: string };

function emptyLine(): LineForm {
  return { productId: "", quantity: "1", unitSalePrice: "" };
}

function formatSaleDate(ts: Timestamp | undefined): string {
  if (!ts?.toDate) return "—";
  try {
    return ts.toDate().toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function isWalkInPaid(row: WalkInSessionDoc): boolean {
  return row.payment_status === "paid";
}

export function WalkInSalesPageContent() {
  const { user, isAdmin } = useAuth();
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [pending, setPending] = useState<Array<{ id: string; data: WalkInSessionDoc }>>([]);
  const [approved, setApproved] = useState<Array<{ id: string; data: WalkInSessionDoc }>>([]);
  const [sessionItemNames, setSessionItemNames] = useState<Record<string, string>>({});
  const [pendingLoading, setPendingLoading] = useState(true);
  const [approvedLoading, setApprovedLoading] = useState(true);

  const [saleDateInput, setSaleDateInput] = useState(() => toDateInputValue(new Date()));
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clerkTodayStr = useMemo(() => toDateInputValue(startOfLocalDay(new Date())), []);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.products), (snap) => {
      setProductsLoading(false);
      const list: ProductOption[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() as ProductDoc;
        const sale = typeof d.sale_price === "number" ? d.sale_price : 0;
        const stock = typeof d.stock_quantity === "number" ? d.stock_quantity : 0;
        list.push({
          id: docSnap.id,
          name: d.name,
          sale_price: sale,
          stock_quantity: stock,
          searchText: `${d.name} ${sale} ${stock}`.toLowerCase(),
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const db = getDb();
    // Single-field equality only — avoids requiring a composite index (status + sale_date)
    // before deploy; sort newest sale dates first in memory.
    const q = query(collection(db, COLLECTIONS.walkInSessions), where("status", "==", "pending"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPendingLoading(false);
        const rows: Array<{ id: string; data: WalkInSessionDoc }> = [];
        snap.forEach((d) => rows.push({ id: d.id, data: d.data() as WalkInSessionDoc }));
        rows.sort((a, b) => {
          const ta = a.data.sale_date?.toMillis?.() ?? 0;
          const tb = b.data.sale_date?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setPending(rows);
      },
      (err) => {
        setPendingLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const db = getDb();
    const q = query(collection(db, COLLECTIONS.walkInSessions), where("status", "==", "approved"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setApprovedLoading(false);
        const rows: Array<{ id: string; data: WalkInSessionDoc }> = [];
        snap.forEach((d) => rows.push({ id: d.id, data: d.data() as WalkInSessionDoc }));
        rows.sort((a, b) => {
          const ta = a.data.sale_date?.toMillis?.() ?? 0;
          const tb = b.data.sale_date?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setApproved(rows);
      },
      (err) => {
        setApprovedLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const db = getDb();
    const allSessions = [...pending, ...approved];
    const sessionIds = Array.from(new Set(allSessions.map((row) => row.id)));

    async function loadSessionItemNames() {
      if (sessionIds.length === 0) {
        if (!cancelled) setSessionItemNames({});
        return;
      }
      const entries = await Promise.all(
        sessionIds.map(async (sessionId) => {
          const lineRows = await fetchWalkInLines(db, sessionId);
          const names = lineRows
            .map((l) => products.find((p) => p.id === l.data.product_id)?.name ?? "Unknown product")
            .filter((name, idx, arr) => arr.indexOf(name) === idx);
          return [sessionId, names.join(", ")] as const;
        }),
      );

      if (!cancelled) {
        setSessionItemNames(Object.fromEntries(entries));
      }
    }

    void loadSessionItemNames();
    return () => {
      cancelled = true;
    };
  }, [approved, pending, products]);

  const effectiveSaleDate = (): Date => {
    if (isAdmin) {
      return startOfLocalDay(parseDateInput(saleDateInput));
    }
    return startOfLocalDay(new Date());
  };

  const buildLineInputs = (): WalkInLineInput[] => {
    const out: WalkInLineInput[] = [];
    for (const row of lines) {
      if (!row.productId.trim()) continue;
      const qty = Number.parseInt(row.quantity.trim(), 10);
      const price =
        row.unitSalePrice.trim() === ""
          ? products.find((p) => p.id === row.productId)?.sale_price ?? 0
          : Number.parseFloat(row.unitSalePrice.replace(/,/g, ""));
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error("Each line needs a positive whole-number quantity.");
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new Error("Each line needs a valid unit sale price.");
      }
      out.push({ productId: row.productId, quantity: qty, unitSalePrice: price });
    }
    if (out.length === 0) {
      throw new Error("Add at least one line with a product selected.");
    }
    return out;
  };

  const resetForm = () => {
    setLines([emptyLine()]);
    setEditingId(null);
    setSaleDateInput(toDateInputValue(new Date()));
    if (!isAdmin) {
      setSaleDateInput(clerkTodayStr);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setSaleDateInput(clerkTodayStr);
    }
  }, [isAdmin, clerkTodayStr]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const inputs = buildLineInputs();
      const db = getDb();
      const saleDate = effectiveSaleDate();
      if (editingId) {
        await replaceWalkInSessionContent(db, editingId, { saleDate, lines: inputs });
        setSuccess("Draft updated.");
      } else {
        await createWalkInSession(db, {
          saleDate,
          lines: inputs,
          uid: user?.uid ?? null,
        });
        setSuccess("Walk-in sale submitted for approval.");
      }
      resetForm();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onEdit = async (sessionId: string) => {
    setError(null);
    setSuccess(null);
    try {
      const db = getDb();
      const [lineRows] = await Promise.all([fetchWalkInLines(db, sessionId)]);
      const sess = pending.find((p) => p.id === sessionId);
      if (sess) {
        const d = sess.data.sale_date;
        if (d?.toDate) {
          setSaleDateInput(toDateInputValue(startOfLocalDay(d.toDate())));
        }
      }
      setLines(
        lineRows.length > 0
          ? lineRows.map((r) => ({
              productId: r.data.product_id,
              quantity: String(r.data.quantity),
              unitSalePrice: String(r.data.unit_sale_price),
            }))
          : [emptyLine()],
      );
      setEditingId(sessionId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    }
  };

  const onApprove = async (sessionId: string) => {
    setError(null);
    setBusyId(sessionId);
    try {
      await approveWalkInSession(getDb(), sessionId);
      setSuccess("Sale approved and recorded.");
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (sessionId: string) => {
    const note = window.prompt("Optional note for rejection (leave empty to skip):") ?? "";
    setError(null);
    setBusyId(sessionId);
    try {
      await rejectWalkInSession(getDb(), sessionId, note);
      setSuccess("Session rejected.");
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (sessionId: string) => {
    if (!window.confirm("Delete this pending walk-in draft?")) return;
    setError(null);
    setBusyId(sessionId);
    try {
      await deletePendingWalkInSession(getDb(), sessionId);
      if (editingId === sessionId) {
        resetForm();
      }
      setSuccess("Draft deleted.");
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onDeleteApproved = async (sessionId: string) => {
    if (!window.confirm("Delete this approved walk-in sale? This will remove sales rows and restock items.")) {
      return;
    }
    setError(null);
    setBusyId(sessionId);
    try {
      await deleteApprovedWalkInSession(getDb(), sessionId);
      setSuccess("Approved walk-in deleted. Stock restored.");
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onSetApprovedPaid = async (sessionId: string) => {
    setError(null);
    setBusyId(sessionId);
    try {
      await markApprovedWalkInSessionPaid(getDb(), sessionId);
      setSuccess("Approved sale marked as paid.");
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));

  return (
    <div className="space-y-10">
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">New walk-in sale</h2>
          <p className="text-sm text-muted-foreground">
            Add products and quantities. Submit creates a <strong>pending</strong> draft. An admin must
            approve before stock and sales totals update.
          </p>
        </div>

        {editingId ? (
          <InlineAlert variant="success">
            Editing draft <span className="font-mono">{editingId}</span>. Save updates the draft, or cancel
            below.
          </InlineAlert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="walkin-sale-date">Business sale date</Label>
            {isAdmin ? (
              <Input
                id="walkin-sale-date"
                type="date"
                value={saleDateInput}
                onChange={(e) => setSaleDateInput(e.target.value)}
                required
              />
            ) : (
              <>
                <Input
                  id="walkin-sale-date"
                  type="date"
                  value={clerkTodayStr}
                  readOnly
                  className="bg-surface-muted"
                  aria-readonly="true"
                />
                <p className="text-xs text-muted-foreground">Clerks can only record sales for today.</p>
              </>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Line items</Label>
            <Button type="button" variant="outline" className="px-3 py-1.5 text-xs" onClick={addLine}>
              Add line
            </Button>
          </div>
          {lines.map((row, idx) => (
            <div
              key={idx}
              className="grid gap-3 rounded-lg border border-border bg-surface-muted/50 p-4 sm:grid-cols-12 sm:items-end"
            >
              <div className="sm:col-span-5">
                <Label htmlFor={`prod-${idx}`}>Product</Label>
                <SearchableSelect
                  options={products}
                  value={row.productId}
                  onChange={(pid) => {
                    const p = products.find((x) => x.id === pid);
                    setLines((prev) => {
                      const next = [...prev];
                      next[idx] = {
                        ...next[idx]!,
                        productId: pid,
                        unitSalePrice:
                          p != null ? String(p.sale_price) : next[idx]!.unitSalePrice,
                      };
                      return next;
                    });
                  }}
                  getDisplayValue={(p) => p.name}
                  renderOption={(p) => (
                    <div className="space-y-0.5">
                      <p className="font-medium text-foreground">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Stock: {p.stock_quantity.toLocaleString()} | Sale: {money(p.sale_price)}
                      </p>
                    </div>
                  )}
                  placeholder={productsLoading ? "Loading products…" : "Search product name, stock, or price"}
                  emptyText="No products match your search."
                  disabled={productsLoading || submitting}
                  ariaLabel={`Choose product for line ${idx + 1}`}
                />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor={`qty-${idx}`}>Quantity</Label>
                <Input
                  id={`qty-${idx}`}
                  type="number"
                  min={1}
                  step={1}
                  value={row.quantity}
                  onChange={(e) =>
                    setLines((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx]!, quantity: e.target.value };
                      return next;
                    })
                  }
                />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor={`price-${idx}`}>Unit sale price</Label>
                <Input
                  id={`price-${idx}`}
                  type="text"
                  inputMode="decimal"
                  placeholder="From product if empty"
                  value={row.unitSalePrice}
                  onChange={(e) =>
                    setLines((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx]!, unitSalePrice: e.target.value };
                      return next;
                    })
                  }
                />
              </div>
              <div className="sm:col-span-1 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive"
                  disabled={lines.length <= 1}
                  onClick={() => removeLine(idx)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>

        {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
        {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting || productsLoading}>
            {submitting ? "Saving…" : editingId ? "Update draft" : "Submit for approval"}
          </Button>
          {editingId ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                setSuccess(null);
              }}
            >
              Cancel edit
            </Button>
          ) : null}
        </div>
      </form>

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Pending approval</h2>
        {pendingLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending walk-in drafts.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-4 py-2.5 font-semibold">Sale date</th>
                  <th className="px-4 py-2.5 font-semibold">Items</th>
                  <th className="px-4 py-2.5 font-semibold">Lines</th>
                  <th className="px-4 py-2.5 font-semibold">Payment</th>
                  <th className="px-4 py-2.5 font-semibold">Session</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-foreground">{formatSaleDate(row.data.sale_date)}</td>
                    <td className="px-4 py-3 text-foreground">
                      {sessionItemNames[row.id] && sessionItemNames[row.id].trim().length > 0
                        ? sessionItemNames[row.id]
                        : "Loading…"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.data.line_count}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.id}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          disabled={busyId !== null}
                          onClick={() => void onEdit(row.id)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          disabled={busyId !== null}
                          onClick={() => void onDelete(row.id)}
                        >
                          {busyId === row.id ? "…" : "Delete"}
                        </Button>
                        {isAdmin ? (
                          <>
                            <Button
                              type="button"
                              className="px-3 py-1.5 text-xs"
                              disabled={busyId !== null}
                              onClick={() => void onApprove(row.id)}
                            >
                              {busyId === row.id ? "…" : "Approve"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="px-3 py-1.5 text-xs text-destructive"
                              disabled={busyId !== null}
                              onClick={() => void onReject(row.id)}
                            >
                              Reject
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Approved</h2>
        {approvedLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : approved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved walk-in sales.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-4 py-2.5 font-semibold">Sale date</th>
                  <th className="px-4 py-2.5 font-semibold">Items</th>
                  <th className="px-4 py-2.5 font-semibold">Lines</th>
                  <th className="px-4 py-2.5 font-semibold">Session</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {approved.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-foreground">{formatSaleDate(row.data.sale_date)}</td>
                    <td className="px-4 py-3 text-foreground">
                      {sessionItemNames[row.id] && sessionItemNames[row.id].trim().length > 0
                        ? sessionItemNames[row.id]
                        : "Loading…"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.data.line_count}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          isWalkInPaid(row.data)
                            ? "rounded-full bg-success-muted px-2 py-0.5 text-xs font-medium text-success"
                            : "rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-foreground"
                        }
                      >
                        {isWalkInPaid(row.data) ? "paid" : "unpaid"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.id}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {isAdmin ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              className="px-3 py-1.5 text-xs"
                              disabled={busyId !== null || isWalkInPaid(row.data)}
                              onClick={() => void onSetApprovedPaid(row.id)}
                            >
                              {busyId === row.id && !isWalkInPaid(row.data) ? "…" : isWalkInPaid(row.data) ? "Paid" : "Set paid"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="px-3 py-1.5 text-xs text-destructive"
                              disabled={busyId !== null}
                              onClick={() => void onDeleteApproved(row.id)}
                            >
                              {busyId === row.id ? "…" : "Delete and restock"}
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No actions</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
