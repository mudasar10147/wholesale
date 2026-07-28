import {
  collection,
  onSnapshot,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { useNewArrivalSettings } from "@/lib/firestore/newArrivalSettings";
import {
  buildOfferPriceIndex,
  selectLiveOffers,
  type OfferPriceIndex,
  type OfferPricingRule,
} from "@/lib/pricing/offerPricing";
import { toDateKey } from "@/lib/social/weekKeys";
import type { SocialOfferDoc } from "@/lib/types/firestore";

/** How often the day key is re-checked. Cheap, and only ever sets state on an actual rollover. */
const DAY_ROLLOVER_POLL_MS = 60_000;

export function subscribeSocialOffers(
  db: Firestore,
  onData: (offers: OfferPricingRule[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  // Equality on one field, so Firestore serves this from the automatic index — no
  // firestore.indexes.json entry needed. The date window is a two-field range Firestore
  // cannot combine here, so selectLiveOffers applies it client-side.
  const q = query(collection(db, COLLECTIONS.socialOffers), where("is_active", "==", true));
  return onSnapshot(
    q,
    (snap) => {
      const rows: OfferPricingRule[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as SocialOfferDoc;
        rows.push({
          id: docSnap.id,
          title: data.title,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
          product_ids: Array.isArray(data.product_ids) ? data.product_ids : [],
          applies_to_all: data.applies_to_all === true,
          includes_new_arrivals: data.includes_new_arrivals === true,
          starts_on: data.starts_on,
          ends_on: data.ends_on,
          is_active: data.is_active,
        });
      });
      // Newest-started first, matching fetchSocialOffers — this is what makes an exact tie
      // between two offers resolve to the more recent one.
      rows.sort((a, b) => b.starts_on.localeCompare(a.starts_on));
      onData(rows);
    },
    onError,
  );
}

/**
 * The offers in force right now, for any surface that shows a price.
 *
 * Returns an empty set immediately so the UI never blocks on this read, and swallows errors so
 * a role without the read — or rules that have not been deployed yet — degrades to plain list
 * prices rather than breaking the page.
 */
export function useLiveOffers(): {
  offers: OfferPricingRule[];
  index: OfferPriceIndex;
  loading: boolean;
} {
  const { settings: newArrivalSettings } = useNewArrivalSettings();
  const [raw, setRaw] = useState<OfferPricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [todayKey, setTodayKey] = useState(() => toDateKey(new Date()));

  useEffect(() => {
    const unsub = subscribeSocialOffers(
      getDb(),
      (next) => {
        setLoading(false);
        setRaw(next);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  // A tab left open overnight would otherwise keep pricing invoice lines from an offer that
  // expired at midnight. Cheap poll, and setState only fires on an actual date change.
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = toDateKey(new Date());
      setTodayKey((prev) => (prev === next ? prev : next));
    }, DAY_ROLLOVER_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const offers = useMemo(() => selectLiveOffers(raw, todayKey), [raw, todayKey]);
  const index = useMemo(
    () => buildOfferPriceIndex(offers, newArrivalSettings.thresholdDays),
    [offers, newArrivalSettings.thresholdDays],
  );

  return { offers, index, loading };
}
