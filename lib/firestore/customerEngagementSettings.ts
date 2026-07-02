import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  defaultCustomerEngagementTierSettings,
  tierDiscountPercent,
  validateCustomerEngagementTierSettings,
  type CustomerEngagementTierSettings,
} from "@/lib/customers/customerEngagementConfig";
import {
  CUSTOMER_ENGAGEMENT_SETTINGS_DOC_ID,
  type CustomerEngagementSettingsDoc,
} from "@/lib/types/firestore";

export type { CustomerEngagementTierSettings } from "@/lib/customers/customerEngagementConfig";
export { defaultCustomerEngagementTierSettings, tierDiscountPercent } from "@/lib/customers/customerEngagementConfig";

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  return n > 0 ? n : fallback;
}

function parseNonNegativeNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function parseDiscountPercent(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return fallback;
  }
  return value;
}

export function parseCustomerEngagementSettingsDoc(
  raw: CustomerEngagementSettingsDoc | undefined,
): CustomerEngagementTierSettings {
  const defaults = defaultCustomerEngagementTierSettings();
  if (!raw) return defaults;

  return {
    rollingWindowDays: parsePositiveInt(raw.rolling_window_days, defaults.rollingWindowDays),
    premiumMinOrders: parsePositiveInt(raw.premium_min_orders, defaults.premiumMinOrders),
    premiumMinSpend: parseNonNegativeNumber(raw.premium_min_spend, defaults.premiumMinSpend),
    premiumDiscountPercent: parseDiscountPercent(
      raw.premium_discount_percent,
      defaults.premiumDiscountPercent,
    ),
    silverMinOrders: parsePositiveInt(raw.silver_min_orders, defaults.silverMinOrders),
    silverMinSpend: parseNonNegativeNumber(raw.silver_min_spend, defaults.silverMinSpend),
    silverMaxSpend: parseNonNegativeNumber(raw.silver_max_spend, defaults.silverMaxSpend),
    silverDiscountPercent: parseDiscountPercent(
      raw.silver_discount_percent,
      defaults.silverDiscountPercent,
    ),
    bronzeOrders: parsePositiveInt(raw.bronze_orders, defaults.bronzeOrders),
    bronzeMaxSpend: parseNonNegativeNumber(raw.bronze_max_spend, defaults.bronzeMaxSpend),
  };
}

export async function loadCustomerEngagementSettings(
  db: Firestore,
): Promise<CustomerEngagementTierSettings> {
  const snap = await getDoc(
    doc(db, COLLECTIONS.settings, CUSTOMER_ENGAGEMENT_SETTINGS_DOC_ID),
  );
  if (!snap.exists()) return defaultCustomerEngagementTierSettings();
  return parseCustomerEngagementSettingsDoc(snap.data() as CustomerEngagementSettingsDoc);
}

export async function saveCustomerEngagementSettings(
  db: Firestore,
  settings: CustomerEngagementTierSettings,
): Promise<void> {
  validateCustomerEngagementTierSettings(settings);

  const payload: Omit<CustomerEngagementSettingsDoc, "updated_at"> & { updated_at: unknown } = {
    rolling_window_days: settings.rollingWindowDays,
    premium_min_orders: settings.premiumMinOrders,
    premium_min_spend: settings.premiumMinSpend,
    premium_discount_percent: settings.premiumDiscountPercent,
    silver_min_orders: settings.silverMinOrders,
    silver_min_spend: settings.silverMinSpend,
    silver_max_spend: settings.silverMaxSpend,
    silver_discount_percent: settings.silverDiscountPercent,
    bronze_orders: settings.bronzeOrders,
    bronze_max_spend: settings.bronzeMaxSpend,
    updated_at: serverTimestamp(),
  };

  await setDoc(doc(db, COLLECTIONS.settings, CUSTOMER_ENGAGEMENT_SETTINGS_DOC_ID), payload, {
    merge: true,
  });
}

export function subscribeCustomerEngagementSettings(
  db: Firestore,
  onData: (settings: CustomerEngagementTierSettings) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, COLLECTIONS.settings, CUSTOMER_ENGAGEMENT_SETTINGS_DOC_ID),
    (snap) => {
      onData(
        snap.exists()
          ? parseCustomerEngagementSettingsDoc(snap.data() as CustomerEngagementSettingsDoc)
          : defaultCustomerEngagementTierSettings(),
      );
    },
    onError,
  );
}

export function useCustomerEngagementSettings(): {
  settings: CustomerEngagementTierSettings;
  loading: boolean;
} {
  const [settings, setSettings] = useState(defaultCustomerEngagementTierSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeCustomerEngagementSettings(
      getDb(),
      (next) => {
        setLoading(false);
        setSettings(next);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  return { settings, loading };
}
