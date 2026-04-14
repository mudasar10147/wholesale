import type { Firestore } from "firebase/firestore";
import {
  fetchAllPartnerLoans,
  fetchPartnerLoansInRange,
  type PartnerLoanRow,
} from "@/lib/firestore/partnerLoans";
import {
  summarizePartnerLoans,
  type PartnerLoanSummary,
} from "@/lib/finance/partnerLoans";

function sortByDateAsc(rows: PartnerLoanRow[]): PartnerLoanRow[] {
  return [...rows].sort((a, b) => a.date.toMillis() - b.date.toMillis());
}

export async function loadPartnerLoanSummaryForPeriod(
  db: Firestore,
  start: Date,
  end: Date,
): Promise<PartnerLoanSummary> {
  const rows = await fetchPartnerLoansInRange(db, start, end);
  return summarizePartnerLoans(rows);
}

export async function loadPartnerLoanSummaryAllTime(
  db: Firestore,
): Promise<PartnerLoanSummary> {
  const rows = await fetchAllPartnerLoans(db);
  return summarizePartnerLoans(rows);
}

export async function loadPartnerLoanLedgerAllTime(
  db: Firestore,
): Promise<PartnerLoanRow[]> {
  const rows = await fetchAllPartnerLoans(db);
  return sortByDateAsc(rows);
}
