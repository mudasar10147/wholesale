import { doc, getDoc, setDoc, serverTimestamp, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CashSettingsDoc } from "@/lib/types/firestore";

export const CASH_SETTINGS_DOC_ID = "cash";

export async function fetchCashSettings(db: Firestore): Promise<CashSettingsDoc | null> {
  const ref = doc(db, COLLECTIONS.settings, CASH_SETTINGS_DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return null;
  }
  return snap.data() as CashSettingsDoc;
}

export function getOpeningBalance(settings: CashSettingsDoc | null): number {
  if (!settings) {
    return 0;
  }
  const v = settings.opening_balance;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function getActualCashBalance(settings: CashSettingsDoc | null): number | null {
  if (!settings) {
    return null;
  }
  const v = settings.actual_cash_balance;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return null;
  }
  return v;
}

export async function setOpeningCashBalance(db: Firestore, openingBalance: number): Promise<void> {
  if (!Number.isFinite(openingBalance)) {
    throw new Error("Opening balance must be a valid number.");
  }
  await setDoc(
    doc(db, COLLECTIONS.settings, CASH_SETTINGS_DOC_ID),
    {
      opening_balance: openingBalance,
      updated_at: serverTimestamp(),
    } satisfies Omit<CashSettingsDoc, "updated_at"> & { updated_at: unknown },
    { merge: true },
  );
}

export async function setActualCashBalance(db: Firestore, actualCashBalance: number): Promise<void> {
  if (!Number.isFinite(actualCashBalance)) {
    throw new Error("Actual cash must be a valid number.");
  }
  await setDoc(
    doc(db, COLLECTIONS.settings, CASH_SETTINGS_DOC_ID),
    {
      actual_cash_balance: actualCashBalance,
      actual_cash_updated_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    } satisfies Partial<Omit<CashSettingsDoc, "updated_at" | "actual_cash_updated_at">> & {
      updated_at: unknown;
      actual_cash_updated_at: unknown;
    },
    { merge: true },
  );
}
