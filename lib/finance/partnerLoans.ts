import type { PartnerLoanEntryType } from "@/lib/types/firestore";
import type { PartnerLoanRow } from "@/lib/firestore/partnerLoans";

export type PartnerLoanSummary = {
  totalLoanIn: number;
  totalRepaid: number;
  pendingTotal: number;
  pendingByPartner: Map<string, number>;
};

function signedAmount(entryType: PartnerLoanEntryType, amount: number): number {
  return entryType === "loan_in" ? amount : -amount;
}

export function summarizePartnerLoans(rows: PartnerLoanRow[]): PartnerLoanSummary {
  let totalLoanIn = 0;
  let totalRepaid = 0;
  const pendingByPartner = new Map<string, number>();

  for (const row of rows) {
    const amt = typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : 0;
    if (amt <= 0) continue;
    if (row.entry_type === "loan_in") totalLoanIn += amt;
    if (row.entry_type === "repayment") totalRepaid += amt;
    const prev = pendingByPartner.get(row.partner_name) ?? 0;
    pendingByPartner.set(row.partner_name, prev + signedAmount(row.entry_type, amt));
  }

  return {
    totalLoanIn,
    totalRepaid,
    pendingTotal: totalLoanIn - totalRepaid,
    pendingByPartner,
  };
}
