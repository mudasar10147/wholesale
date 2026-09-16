/**
 * Settling the few rupees left when a customer rounds a payment down.
 *
 * A bill of 1,630 is paid with 1,600 and the 30 is waved off at the counter. Left
 * alone that 30 follows the shop around forever — on their balance, on the delivery
 * list, in the ledger — so the payment dialog offers to close it.
 *
 * The 30 is booked as an invoice discount, which is what it is: revenue given up, not
 * cash received. Nothing pretends the money arrived.
 *
 * The cap is the safety rail. Settling is meant for rounding, so anything larger has
 * to be a deliberate discount on the invoice instead of a tick-box during payment.
 */

/** Most that may be settled on one invoice. Bigger concessions go through Apply discount. */
export const MAX_INVOICE_SETTLEMENT = 100;

/** Balances at or below this are already settled — the app's usual money epsilon. */
const SETTLED_EPSILON = 0.01;

export type SettlementOffer = {
  /** What would still be due after this payment. */
  remainder: number;
  /** The remainder is small enough to wave off. */
  canSettle: boolean;
  /** There is a remainder, but it is above the cap, so it stays due. */
  overCap: boolean;
  /** The cap in force, for the message. */
  maxSettlement: number;
};

function roundMoney2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Whether a payment of `payment` against `amountDue` leaves a remainder that may be
 * settled. Payments that are zero, negative or larger than the balance offer nothing:
 * an overpayment is refused elsewhere, and there is no remainder to wave off.
 */
export function describeSettlementOffer(
  amountDue: number,
  payment: number,
  maxSettlement: number = MAX_INVOICE_SETTLEMENT,
): SettlementOffer {
  const due = roundMoney2(amountDue);
  const paid = roundMoney2(payment);
  const none: SettlementOffer = { remainder: 0, canSettle: false, overCap: false, maxSettlement };
  if (!(paid > 0) || paid > due + SETTLED_EPSILON) return none;

  const remainder = roundMoney2(due - paid);
  if (remainder <= SETTLED_EPSILON) return none;
  return {
    remainder,
    canSettle: remainder <= maxSettlement + SETTLED_EPSILON,
    overCap: remainder > maxSettlement + SETTLED_EPSILON,
    maxSettlement,
  };
}
