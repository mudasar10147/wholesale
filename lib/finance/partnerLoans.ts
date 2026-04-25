import type { PartnerLoanEntryType } from "@/lib/types/firestore";
import type { PartnerLoanRow } from "@/lib/firestore/partnerLoans";

export type PartnerLoanSummary = {
  borrowedIn: number;
  borrowedRepaidOut: number;
  givenOut: number;
  givenReturnedIn: number;
  netBorrowedLiability: number;
  netGivenReceivable: number;
  totalLoanIn: number;
  totalRepaid: number;
  pendingTotal: number;
  pendingByPartner: Map<string, number>;
};

function signedAmount(entryType: PartnerLoanEntryType, amount: number): number {
  if (entryType === "loan_in" || entryType === "loan_given_return") return amount;
  return -amount;
}

export function summarizePartnerLoans(rows: PartnerLoanRow[]): PartnerLoanSummary {
  let borrowedIn = 0;
  let borrowedRepaidOut = 0;
  let givenOut = 0;
  let givenReturnedIn = 0;
  const pendingByPartner = new Map<string, number>();

  for (const row of rows) {
    const amt = typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : 0;
    if (amt <= 0) continue;
    if (row.entry_type === "loan_in") borrowedIn += amt;
    if (row.entry_type === "repayment") borrowedRepaidOut += amt;
    if (row.entry_type === "loan_given") givenOut += amt;
    if (row.entry_type === "loan_given_return") givenReturnedIn += amt;
    const prev = pendingByPartner.get(row.partner_name) ?? 0;
    pendingByPartner.set(row.partner_name, prev + signedAmount(row.entry_type, amt));
  }

  const netBorrowedLiability = borrowedIn - borrowedRepaidOut;
  const netGivenReceivable = givenOut - givenReturnedIn;
  const totalLoanIn = borrowedIn;
  const totalRepaid = borrowedRepaidOut;
  const pendingTotal = netBorrowedLiability - netGivenReceivable;

  return {
    borrowedIn,
    borrowedRepaidOut,
    givenOut,
    givenReturnedIn,
    netBorrowedLiability,
    netGivenReceivable,
    totalLoanIn,
    totalRepaid,
    pendingTotal,
    pendingByPartner,
  };
}
