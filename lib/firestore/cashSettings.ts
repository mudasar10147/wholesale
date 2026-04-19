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
