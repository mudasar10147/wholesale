"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  fetchSocialPostsForWeek,
  fetchSocialPostsForWeeks,
  type SocialPostRow,
} from "@/lib/firestore/socialPosts";
import { fetchSocialOffers, type SocialOfferRow } from "@/lib/firestore/socialOffers";
import {
  loadSocialMediaSettings,
  type SocialMediaSettings,
} from "@/lib/firestore/socialSettings";
import { fetchSocialWeekPlan, type SocialWeekPlanRow } from "@/lib/firestore/socialWeekPlans";
import { DEFAULT_SOCIAL_MEDIA_SETTINGS } from "@/lib/social/captions";
import type { SocialProductRow } from "@/lib/social/types";
import { shiftWeekKey } from "@/lib/social/weekKeys";
import type { ProductDoc } from "@/lib/types/firestore";

/** How far back a product counts as "already shared" for the repeat warning. */
const RECENT_WEEKS = 2;

export type SocialWeekData = {
  products: SocialProductRow[];
  productsById: Map<string, SocialProductRow>;
  settings: SocialMediaSettings;
  offers: SocialOfferRow[];
  posts: SocialPostRow[];
  plan: SocialWeekPlanRow | null;
  /** Product ids shared in the previous two weeks — surfaced so the group is not spammed. */
  recentlyPostedIds: Set<string>;
  loading: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  reloadWeek: () => Promise<void>;
  reloadOffers: () => Promise<void>;
};

/**
 * Everything one week of the planner needs, loaded once. The overview page and the plan
 * builder show the same week two different ways, so they share the loading rather than
 * each growing their own copy of it.
 */
export function useSocialWeek(weekKey: string): SocialWeekData {
  const [products, setProducts] = useState<SocialProductRow[]>([]);
  const [settings, setSettings] = useState<SocialMediaSettings>(DEFAULT_SOCIAL_MEDIA_SETTINGS);
  const [offers, setOffers] = useState<SocialOfferRow[]>([]);
  const [posts, setPosts] = useState<SocialPostRow[]>([]);
  const [plan, setPlan] = useState<SocialWeekPlanRow | null>(null);
  const [recentlyPostedIds, setRecentlyPostedIds] = useState<Set<string>>(new Set());

  // Both loads gate the UI, and the products one is the load-bearing half: a post resolves
  // its product_ids through this list, so opening one before the products land would show an
  // empty post — and saving it would then wipe the products off it for real.
  const [productsLoading, setProductsLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  // Products, offers and settings do not change per week — loaded once.
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const db = getDb();
        const [snap, loadedSettings, loadedOffers] = await Promise.all([
          getDocs(collection(db, COLLECTIONS.products)),
          loadSocialMediaSettings(db),
          fetchSocialOffers(db),
        ]);
        if (!active) return;

        const rows: SocialProductRow[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as ProductDoc;
          rows.push({
            id: docSnap.id,
            name: typeof data.name === "string" ? data.name : "Product",
            category: typeof data.category === "string" ? data.category : undefined,
            salePrice: typeof data.sale_price === "number" ? data.sale_price : 0,
            stockQuantity: typeof data.stock_quantity === "number" ? data.stock_quantity : 0,
            imageUrl: typeof data.image_url === "string" ? data.image_url : undefined,
            imagePath: typeof data.image_path === "string" ? data.image_path : undefined,
            createdAtMs:
              data.created_at && typeof data.created_at.toMillis === "function"
                ? data.created_at.toMillis()
                : undefined,
          });
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));

        setProducts(rows);
        setSettings(loadedSettings);
        setOffers(loadedOffers);
      } catch (err) {
        if (active) setError(getFirestoreUserMessage(err));
      } finally {
        if (active) setProductsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const reloadWeek = useCallback(async () => {
    const db = getDb();
    const previousWeeks = Array.from({ length: RECENT_WEEKS }, (_, i) =>
      shiftWeekKey(weekKey, -(i + 1)),
    );
    const [weekPosts, priorPosts, weekPlan] = await Promise.all([
      fetchSocialPostsForWeek(db, weekKey),
      fetchSocialPostsForWeeks(db, previousWeeks),
      fetchSocialWeekPlan(db, weekKey),
    ]);
    setPosts(weekPosts);
    setPlan(weekPlan);
    setRecentlyPostedIds(
      new Set(
        priorPosts
          .filter((post) => post.status === "posted" || post.status === "ready")
          .flatMap((post) => post.product_ids),
      ),
    );
  }, [weekKey]);

  useEffect(() => {
    let active = true;
    async function load() {
      setWeekLoading(true);
      setError(null);
      try {
        await reloadWeek();
      } catch (err) {
        if (active) setError(getFirestoreUserMessage(err));
      } finally {
        if (active) setWeekLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [reloadWeek]);

  const reloadOffers = useCallback(async () => {
    try {
      setOffers(await fetchSocialOffers(getDb()));
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    }
  }, []);

  return {
    products,
    productsById,
    settings,
    offers,
    posts,
    plan,
    recentlyPostedIds,
    loading: productsLoading || weekLoading,
    error,
    setError,
    reloadWeek,
    reloadOffers,
  };
}
