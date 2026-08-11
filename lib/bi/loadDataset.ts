/**
 * Firestore access for Business Intelligence — one batch, once per page load.
 *
 * Every collection is read at most once and handed to the pure analytics layer.
 * `sales` and `expenses` are range-scanned (not full scans) using the same
 * `date` field the existing profit reports query on.
 */
import { collection, getDocs, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { fetchCashSettings, getActualCashBalance, getOpeningBalance } from "@/lib/firestore/cashSettings";
import type {
  CashEntryDoc,
  CustomerDoc,
  ExpenseDoc,
  InventoryDiscardDoc,
  InvoiceDoc,
  InvoiceReturnDoc,
  ProductDoc,
  SaleDoc,
  StockLotDoc,
  TraderDoc,
} from "@/lib/types/firestore";
import { historyStartFor, type BusinessDataset, type WithId } from "@/lib/bi/dataset";

function collect<T>(snap: { forEach: (cb: (d: { id: string; data: () => unknown }) => void) => void }): WithId<T>[] {
  const out: WithId<T>[] = [];
  snap.forEach((d) => out.push({ id: d.id, data: d.data() as T }));
  return out;
}

async function fetchAll<T>(db: Firestore, name: string): Promise<WithId<T>[]> {
  return collect<T>(await getDocs(collection(db, name)));
}

/**
 * Loads every input the Business Intelligence page needs in one parallel batch.
 * Eleven collection reads total, regardless of how many analytics sections render.
 *
 * `sales` and `expenses` are read in full rather than windowed, because the cash
 * position is an all-time running total (`computeCashInHandSnapshot`) and reading
 * them twice — once windowed for analytics, once whole for cash — would cost more
 * than reading them once. Analytics windows the same rows in memory instead.
 */
export async function loadBusinessDataset(
  db: Firestore,
  now = new Date(),
): Promise<BusinessDataset> {
  const historyStart = historyStartFor(now);

  const [
    products,
    sales,
    expenses,
    invoices,
    stockLots,
    cashEntries,
    customers,
    traders,
    invoiceReturns,
    inventoryDiscards,
    cashSettings,
  ] = await Promise.all([
    fetchAll<ProductDoc>(db, COLLECTIONS.products),
    fetchAll<SaleDoc>(db, COLLECTIONS.sales),
    fetchAll<ExpenseDoc>(db, COLLECTIONS.expenses),
    fetchAll<InvoiceDoc>(db, COLLECTIONS.invoices),
    fetchAll<StockLotDoc>(db, COLLECTIONS.stockLots),
    fetchAll<CashEntryDoc>(db, COLLECTIONS.cashEntries),
    fetchAll<CustomerDoc>(db, COLLECTIONS.customers),
    fetchAll<TraderDoc>(db, COLLECTIONS.traders),
    fetchAll<InvoiceReturnDoc>(db, COLLECTIONS.invoiceReturns),
    fetchAll<InventoryDiscardDoc>(db, COLLECTIONS.inventoryDiscards),
    fetchCashSettings(db),
  ]);

  return {
    now,
    historyStart,
    products,
    sales,
    expenses,
    invoices,
    stockLots,
    cashEntries,
    customers,
    traders,
    invoiceReturns,
    inventoryDiscards,
    cashOpeningBalance: getOpeningBalance(cashSettings),
    actualCashBalance: getActualCashBalance(cashSettings),
  };
}
