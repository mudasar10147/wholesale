import type { CashEntryDoc, LoanEntryKind } from "@/lib/types/firestore";

/** Minimal shape needed to compute loan balances (a cash entry). */
export type LoanEntryInput = Pick<
  CashEntryDoc,
  "amount" | "party_id" | "party_name" | "loan_kind"
>;

export type PartyLoanBalance = {
  partyId: string;
  partyName: string;
  /** Cash received as a loan (you owe more). */
  borrowed: number;
  /** Cash paid back on what you borrowed (you owe less). */
  repaid: number;
  /** Cash lent out (they owe you more). */
  lent: number;
  /** Cash collected back on what you lent (they owe you less). */
  collected: number;
  /** Outstanding amount you still owe this party (>= 0). */
  youOwe: number;
  /** Outstanding amount this party still owes you (>= 0). */
  owedToYou: number;
  /** Signed net from your perspective: positive = they owe you, negative = you owe them. */
  net: number;
};

export type LoanBalancesResult = {
  parties: PartyLoanBalance[];
  totalYouOwe: number;
  totalOwedToYou: number;
  /** Positive = net owed to you, negative = net you owe. */
  netPosition: number;
  /** Number of parties with a non-zero outstanding balance. */
  openCount: number;
};

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function isLoanKind(value: unknown): value is LoanEntryKind {
  return (
    value === "borrowed" || value === "repaid" || value === "lent" || value === "collected"
  );
}

type Accumulator = {
  partyId: string;
  partyName: string;
  borrowed: number;
  repaid: number;
  lent: number;
  collected: number;
};

/**
 * Net a set of cash entries into per-party loan balances. Only entries that
 * carry a `loan_kind` and a `party_id` are considered.
 */
export function computeLoanBalances(entries: readonly LoanEntryInput[]): LoanBalancesResult {
  const byParty = new Map<string, Accumulator>();

  for (const entry of entries) {
    const kind = entry.loan_kind;
    const partyId = entry.party_id?.trim();
    const amount = typeof entry.amount === "number" ? entry.amount : 0;
    if (!isLoanKind(kind) || !partyId || !Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    let acc = byParty.get(partyId);
    if (!acc) {
      acc = {
        partyId,
        partyName: entry.party_name?.trim() || "Unknown party",
        borrowed: 0,
        repaid: 0,
        lent: 0,
        collected: 0,
      };
      byParty.set(partyId, acc);
    } else if (entry.party_name?.trim()) {
      // Keep the most recent non-empty name we encounter.
      acc.partyName = entry.party_name.trim();
    }

    acc[kind] += amount;
  }

  const parties: PartyLoanBalance[] = [];
  let totalYouOwe = 0;
  let totalOwedToYou = 0;
  let openCount = 0;

  for (const acc of byParty.values()) {
    const borrowed = roundMoney2(acc.borrowed);
    const repaid = roundMoney2(acc.repaid);
    const lent = roundMoney2(acc.lent);
    const collected = roundMoney2(acc.collected);

    const payable = roundMoney2(borrowed - repaid);
    const receivable = roundMoney2(lent - collected);
    const net = roundMoney2(receivable - payable);

    const youOwe = payable > 0 ? payable : 0;
    const owedToYou = receivable > 0 ? receivable : 0;

    totalYouOwe = roundMoney2(totalYouOwe + youOwe);
    totalOwedToYou = roundMoney2(totalOwedToYou + owedToYou);
    if (net !== 0) openCount += 1;

    parties.push({
      partyId: acc.partyId,
      partyName: acc.partyName,
      borrowed,
      repaid,
      lent,
      collected,
      youOwe,
      owedToYou,
      net,
    });
  }

  // Largest absolute outstanding balance first, then by name.
  parties.sort((a, b) => {
    const diff = Math.abs(b.net) - Math.abs(a.net);
    if (diff !== 0) return diff;
    return a.partyName.localeCompare(b.partyName, undefined, { sensitivity: "base" });
  });

  return {
    parties,
    totalYouOwe,
    totalOwedToYou,
    netPosition: roundMoney2(totalOwedToYou - totalYouOwe),
    openCount,
  };
}
