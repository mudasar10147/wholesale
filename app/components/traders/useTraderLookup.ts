"use client";

import { useMemo } from "react";
import { useTraders } from "@/lib/firestore/referenceData";
import {
  buildTraderLookup,
  traderRowsFromDocs,
  type TraderLookup,
} from "@/lib/inventory/traderLookup";

export function useTraderLookup(): TraderLookup {
  const { rows } = useTraders();
  return useMemo(
    () => buildTraderLookup(traderRowsFromDocs(rows.map((r) => ({ id: r.id, ...r.data })))),
    [rows],
  );
}
