"use client";

/**
 * Shared subscriptions for the collections almost every page needs.
 *
 * `products`, `customers` and `traders` change rarely but were each re-read by
 * every component that displayed them — opening `/sales/new` read all products
 * and customers, then `/sales` read customers again, then `/customers` read them
 * five more times. Together these are only ~314 documents, so the fix is to read
 * each once per session and share it.
 *
 * One `onSnapshot` per collection is started on first use and deliberately kept
 * alive after the last consumer unmounts: dropping it would mean paying the full
 * collection again on the next navigation, which is the cost this exists to
 * remove. Live updates still arrive, and only changed documents are billed.
 */
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { useMemo, useSyncExternalStore } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { isProductActive } from "@/lib/products/archive";
import type { CustomerDoc, ProductDoc, TraderDoc } from "@/lib/types/firestore";

export type RefRow<T> = { id: string; data: T };

export type RefState<T> = {
  rows: RefRow<T>[];
  loading: boolean;
  error: string | null;
};

/** Stable identity so `useSyncExternalStore` does not loop before data arrives. */
const EMPTY: RefState<never> = { rows: [], loading: true, error: null };

class ReferenceStore<T> {
  private state: RefState<T> = EMPTY as RefState<T>;
  private subscribers = new Set<() => void>();
  private unsubscribe: Unsubscribe | null = null;

  constructor(private readonly collectionName: string) {}

  getSnapshot = (): RefState<T> => this.state;

  /** Server render has no Firestore; consumers see the loading state. */
  getServerSnapshot = (): RefState<T> => EMPTY as RefState<T>;

  subscribe = (onStoreChange: () => void): (() => void) => {
    this.subscribers.add(onStoreChange);
    this.start();
    return () => {
      this.subscribers.delete(onStoreChange);
      // Intentionally keeps the listener open — see the module comment.
    };
  };

  private start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = onSnapshot(
      collection(getDb(), this.collectionName),
      (snap) => {
        const rows: RefRow<T>[] = [];
        snap.forEach((d) => rows.push({ id: d.id, data: d.data() as T }));
        this.state = { rows, loading: false, error: null };
        this.emit();
      },
      (err) => {
        this.state = { rows: this.state.rows, loading: false, error: getFirestoreUserMessage(err) };
        this.emit();
      },
    );
  }

  private emit(): void {
    for (const cb of this.subscribers) cb();
  }

  /** Test/sign-out seam: drops the listener and cached rows. */
  reset(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.state = EMPTY as RefState<T>;
    this.emit();
  }
}

const productStore = new ReferenceStore<ProductDoc>(COLLECTIONS.products);
const customerStore = new ReferenceStore<CustomerDoc>(COLLECTIONS.customers);
const traderStore = new ReferenceStore<TraderDoc>(COLLECTIONS.traders);

function useStore<T>(store: ReferenceStore<T>): RefState<T> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

/**
 * All products including archived ones, read once per session and shared.
 * Prefer {@link useActiveProducts} for anything the user picks from, and
 * {@link useProductNames} for resolving names on historical records.
 */
export function useProducts(): RefState<ProductDoc> {
  return useStore(productStore);
}

/**
 * Products a user can still act on — archived ones are dropped.
 *
 * This is what every picker, catalog, dashboard and report should read. The
 * filter is in memory because the shared listener already holds the whole
 * collection; a `where` clause here would cost a composite index and save
 * nothing.
 */
export function useActiveProducts(): RefState<ProductDoc> {
  const state = useProducts();
  return useMemo(
    () => ({ ...state, rows: state.rows.filter((row) => isProductActive(row.data)) }),
    [state],
  );
}

/** All customers, read once per session and shared. */
export function useCustomers(): RefState<CustomerDoc> {
  return useStore(customerStore);
}

/** All traders, read once per session and shared. */
export function useTraders(): RefState<TraderDoc> {
  return useStore(traderStore);
}

/**
 * Customer id → display name, falling back to the id. This is what every list
 * view actually wanted from the customers collection.
 */
export function useCustomerNames(): Map<string, string> {
  const { rows } = useCustomers();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const { id, data } of rows) map.set(id, data.name?.trim() || id);
    return map;
  }, [rows]);
}

/**
 * Product id → display name, falling back to the id.
 *
 * Deliberately spans **archived products too**: invoices, returns, discards and
 * ledger rows store only `product_id`, so excluding archived products here is
 * exactly what would make old records render raw Firestore ids. Every history
 * view should read this instead of opening its own products listener.
 */
export function useProductNames(): Map<string, string> {
  const { rows } = useProducts();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const { id, data } of rows) map.set(id, data.name?.trim() || id);
    return map;
  }, [rows]);
}

/** Drops every shared listener — call on sign-out so the next user re-reads. */
export function resetReferenceData(): void {
  productStore.reset();
  customerStore.reset();
  traderStore.reset();
}
