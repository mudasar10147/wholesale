/**
 * Run: npm run test:loans
 */
import assert from "node:assert/strict";
import { computeLoanBalances, type LoanEntryInput } from "./loanBalances.ts";

const entries: LoanEntryInput[] = [
  // Party A: borrowed 200,000, repaid 50,000 -> you owe 150,000.
  { amount: 200000, party_id: "a", party_name: "Relative", loan_kind: "borrowed" },
  { amount: 50000, party_id: "a", party_name: "Relative", loan_kind: "repaid" },
  // Party B: lent 30,000, collected 10,000 -> they owe you 20,000.
  { amount: 30000, party_id: "b", party_name: "Trader Bob", loan_kind: "lent" },
  { amount: 10000, party_id: "b", party_name: "Trader Bob", loan_kind: "collected" },
  // Party C: mixed -> borrowed 5,000 and lent 8,000 -> net they owe you 3,000.
  { amount: 5000, party_id: "c", party_name: "Mixed", loan_kind: "borrowed" },
  { amount: 8000, party_id: "c", party_name: "Mixed", loan_kind: "lent" },
  // Non-loan and invalid entries are ignored.
  { amount: 99999, party_id: "a", party_name: "Relative" },
  { amount: 0, party_id: "b", party_name: "Trader Bob", loan_kind: "lent" },
  { amount: 1000, loan_kind: "borrowed" },
];

const result = computeLoanBalances(entries);

const a = result.parties.find((p) => p.partyId === "a");
assert.ok(a);
assert.equal(a.borrowed, 200000);
assert.equal(a.repaid, 50000);
assert.equal(a.youOwe, 150000);
assert.equal(a.owedToYou, 0);
assert.equal(a.net, -150000);

const b = result.parties.find((p) => p.partyId === "b");
assert.ok(b);
assert.equal(b.lent, 30000);
assert.equal(b.collected, 10000);
assert.equal(b.owedToYou, 20000);
assert.equal(b.youOwe, 0);
assert.equal(b.net, 20000);

const c = result.parties.find((p) => p.partyId === "c");
assert.ok(c);
// Payable 5,000, receivable 8,000 -> net +3,000 (they owe you), and both buckets show outstanding.
assert.equal(c.youOwe, 5000);
assert.equal(c.owedToYou, 8000);
assert.equal(c.net, 3000);

// Totals.
assert.equal(result.totalYouOwe, 150000 + 5000);
assert.equal(result.totalOwedToYou, 20000 + 8000);
assert.equal(result.netPosition, 28000 - 155000);
assert.equal(result.openCount, 3);

// Sorted by largest absolute net first.
assert.equal(result.parties[0].partyId, "a");

// Empty input is handled.
const empty = computeLoanBalances([]);
assert.equal(empty.parties.length, 0);
assert.equal(empty.totalYouOwe, 0);
assert.equal(empty.totalOwedToYou, 0);
assert.equal(empty.netPosition, 0);
assert.equal(empty.openCount, 0);

console.log("loanBalances tests passed");
