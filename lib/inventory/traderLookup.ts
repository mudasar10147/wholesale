import type { TraderDoc } from "@/lib/types/firestore";

export const UNLINKED_TRADER_KEY = "__unlinked__";
export const UNLINKED_TRADER_LABEL = "Unknown trader";

export type TraderLookupEntry = {
  name: string;
  phone?: string;
  city?: string;
  contact_person?: string;
};

export type TraderLookup = ReadonlyMap<string, TraderLookupEntry>;

export type TraderLookupRow = {
  id: string;
  name: string;
  phone?: string;
  city?: string;
  contact_person?: string;
};

export function buildTraderLookup(traders: readonly TraderLookupRow[]): TraderLookup {
  const map = new Map<string, TraderLookupEntry>();
  for (const trader of traders) {
    map.set(trader.id, {
      name: trader.name,
      phone: trader.phone,
      city: trader.city,
      contact_person: trader.contact_person,
    });
  }
  return map;
}

export function traderNameForLot(
  lot: { trader_id?: string; purchase_source?: string },
  lookup: TraderLookup,
): string {
  const traderId = lot.trader_id?.trim();
  if (traderId) {
    const entry = lookup.get(traderId);
    if (entry?.name) return entry.name;
  }
  return UNLINKED_TRADER_LABEL;
}

export function traderEntryForLot(
  lot: { trader_id?: string },
  lookup: TraderLookup,
): (TraderLookupEntry & { id: string }) | null {
  const traderId = lot.trader_id?.trim();
  if (!traderId) return null;
  const entry = lookup.get(traderId);
  if (!entry) return null;
  return { id: traderId, ...entry };
}

export function traderRowsFromDocs(
  docs: readonly ({ id: string } & Pick<TraderDoc, "name" | "phone" | "city" | "contact_person">)[],
): TraderLookupRow[] {
  return docs.map((doc) => ({
    id: doc.id,
    name: doc.name,
    phone: doc.phone,
    city: doc.city,
    contact_person: doc.contact_person,
  }));
}
