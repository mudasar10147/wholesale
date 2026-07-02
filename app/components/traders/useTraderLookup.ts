"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  buildTraderLookup,
  traderRowsFromDocs,
  type TraderLookup,
} from "@/lib/inventory/traderLookup";
import type { TraderDoc } from "@/lib/types/firestore";

export function useTraderLookup(): TraderLookup {
  const [lookup, setLookup] = useState<TraderLookup>(() => new Map());

  useEffect(() => {
    const unsub = onSnapshot(collection(getDb(), COLLECTIONS.traders), (snap) => {
      const rows = traderRowsFromDocs(
        snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as TraderDoc),
        })),
      );
      setLookup(buildTraderLookup(rows));
    });
    return () => unsub();
  }, []);

  return lookup;
}
