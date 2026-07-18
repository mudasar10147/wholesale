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
  defaultNewArrivalSettings,
  validateNewArrivalSettings,
  type NewArrivalSettings,
} from "@/lib/products/newArrival";
import {
  DEFAULT_NEW_ARRIVAL_THRESHOLD_DAYS,
  NEW_ARRIVAL_SETTINGS_DOC_ID,
  type NewArrivalSettingsDoc,
} from "@/lib/types/firestore";

export type { NewArrivalSettings } from "@/lib/products/newArrival";
export { defaultNewArrivalSettings } from "@/lib/products/newArrival";

export function parseNewArrivalSettingsDoc(
  raw: NewArrivalSettingsDoc | undefined,
): NewArrivalSettings {
  if (!raw) return defaultNewArrivalSettings();
  const days = raw.threshold_days;
  if (!Number.isFinite(days)) return defaultNewArrivalSettings();
  const rounded = Math.round(days);
  if (rounded < 1 || rounded > 365) {
    return { thresholdDays: DEFAULT_NEW_ARRIVAL_THRESHOLD_DAYS };
  }
  return { thresholdDays: rounded };
}

export async function loadNewArrivalSettings(db: Firestore): Promise<NewArrivalSettings> {
  const snap = await getDoc(doc(db, COLLECTIONS.settings, NEW_ARRIVAL_SETTINGS_DOC_ID));
  if (!snap.exists()) return defaultNewArrivalSettings();
  return parseNewArrivalSettingsDoc(snap.data() as NewArrivalSettingsDoc);
}

export async function saveNewArrivalSettings(
  db: Firestore,
  settings: NewArrivalSettings,
): Promise<void> {
  validateNewArrivalSettings(settings);
  const payload: Omit<NewArrivalSettingsDoc, "updated_at"> & { updated_at: unknown } = {
    threshold_days: settings.thresholdDays,
    updated_at: serverTimestamp(),
  };
  await setDoc(doc(db, COLLECTIONS.settings, NEW_ARRIVAL_SETTINGS_DOC_ID), payload, {
    merge: true,
  });
}

export function subscribeNewArrivalSettings(
  db: Firestore,
  onData: (settings: NewArrivalSettings) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, COLLECTIONS.settings, NEW_ARRIVAL_SETTINGS_DOC_ID),
    (snap) => {
      onData(
        snap.exists()
          ? parseNewArrivalSettingsDoc(snap.data() as NewArrivalSettingsDoc)
          : defaultNewArrivalSettings(),
      );
    },
    onError,
  );
}

/**
 * Live new-arrival window, for any product surface that wants to show the badge.
 * Defaults are returned immediately so the UI never blocks on this read.
 */
export function useNewArrivalSettings(): { settings: NewArrivalSettings; loading: boolean } {
  const [settings, setSettings] = useState(defaultNewArrivalSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeNewArrivalSettings(
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
