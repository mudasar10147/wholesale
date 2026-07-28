export type InvoiceCalcLineInput = {
  product_id: string;
  quantity: number;
  unit_price: number;
  /** The clerk's own discount, typed on the line. */
  line_discount: number;
  /**
   * Discount from a live promotional offer, kept apart from `line_discount` so the receipt can
   * show the saving and the two never overwrite each other. Optional: absent means none, which
   * is how every line written before offers existed reads.
   */
  offer_discount?: number;
  /** Offer title, carried through untouched so the receipt can name the campaign. */
  offer_label?: string;
};

export type InvoiceCalculatedLine = {
  product_id: string;
  quantity: number;
  unit_price: number;
  line_discount: number;
  offer_discount: number;
  offer_label?: string;
  line_delivery_charge: number;
  line_total: number;
};

export type InvoiceCalculatedSummary = {
  lines: InvoiceCalculatedLine[];
  subtotal_amount: number;
  delivery_charge: number;
  discount_amount: number;
  total_amount: number;
};

function toCents(n: number): number {
  return Math.round(n * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

type AllocationPart = { baseCents: number; remainderScore: number; idx: number };

function allocateByWeight(totalCents: number, weights: number[]): number[] {
  if (totalCents <= 0 || weights.length === 0) {
    return weights.map(() => 0);
  }
  const sumWeight = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (sumWeight <= 0) {
    const out = weights.map(() => 0);
    out[0] = totalCents;
    return out;
  }

  const parts: AllocationPart[] = weights.map((w, idx) => {
    const exact = (Math.max(0, w) / sumWeight) * totalCents;
    const base = Math.floor(exact);
    return { baseCents: base, remainderScore: exact - base, idx };
  });

  const used = parts.reduce((acc, p) => acc + p.baseCents, 0);
  let remaining = totalCents - used;
  parts.sort((a, b) => b.remainderScore - a.remainderScore);

  let ptr = 0;
  while (remaining > 0 && ptr < parts.length) {
    parts[ptr]!.baseCents += 1;
    remaining -= 1;
    ptr += 1;
    if (ptr >= parts.length) ptr = 0;
  }

  const out = weights.map(() => 0);
  for (const p of parts) {
    out[p.idx] = p.baseCents;
  }
  return out;
}

/**
 * Calculates line totals with allocated delivery charge.
 * Formula:
 * - net_line = (quantity * unit_price) - line_discount - offer_discount
 * - line_total = net_line + line_delivery_charge
 * - subtotal = sum(net_line)
 * - total = subtotal - discount_amount + delivery_charge
 *
 * The offer discount is taken first and the clerk's own discount is clamped to what is left,
 * so when the two together exceed the line it is the manual one that gives way — an offer is a
 * price the customer was already shown. Emitted line_discount/offer_discount are the clamped
 * values, so the identity firestore.rules re-checks holds exactly.
 */
export function calculateInvoiceSummary(params: {
  lines: InvoiceCalcLineInput[];
  delivery_charge: number;
  discount_amount: number;
}): InvoiceCalculatedSummary {
  const validLines = params.lines.map((line) => {
    const quantity = Number.isFinite(line.quantity) ? Math.max(0, Math.trunc(line.quantity)) : 0;
    const unitPrice = Number.isFinite(line.unit_price) ? Math.max(0, line.unit_price) : 0;
    const rawBaseCents = toCents(quantity * unitPrice);

    const offerDiscount = Number.isFinite(line.offer_discount)
      ? Math.max(0, line.offer_discount as number)
      : 0;
    const offerDiscountCents = Math.min(toCents(offerDiscount), rawBaseCents);

    const lineDiscount = Number.isFinite(line.line_discount) ? Math.max(0, line.line_discount) : 0;
    const remainingCents = rawBaseCents - offerDiscountCents;
    const clampedDiscountCents = Math.min(toCents(lineDiscount), remainingCents);

    const netCents = rawBaseCents - offerDiscountCents - clampedDiscountCents;

    return {
      product_id: line.product_id,
      quantity,
      unit_price: fromCents(toCents(unitPrice)),
      line_discount_cents: clampedDiscountCents,
      offer_discount_cents: offerDiscountCents,
      offer_label: line.offer_label,
      net_cents: netCents,
    };
  });

  const deliveryCents = toCents(Math.max(0, params.delivery_charge));
  const invoiceDiscountCents = toCents(Math.max(0, params.discount_amount));
  const subtotalCents = validLines.reduce((acc, line) => acc + line.net_cents, 0);
  const allocations = allocateByWeight(
    deliveryCents,
    validLines.map((line) => line.net_cents),
  );

  const lines: InvoiceCalculatedLine[] = validLines.map((line, idx) => {
    const lineDeliveryCents = allocations[idx] ?? 0;
    return {
      product_id: line.product_id,
      quantity: line.quantity,
      unit_price: line.unit_price,
      line_discount: fromCents(line.line_discount_cents),
      offer_discount: fromCents(line.offer_discount_cents),
      ...(line.offer_label ? { offer_label: line.offer_label } : {}),
      line_delivery_charge: fromCents(lineDeliveryCents),
      line_total: fromCents(line.net_cents + lineDeliveryCents),
    };
  });

  const totalCents = Math.max(0, subtotalCents - invoiceDiscountCents + deliveryCents);
  return {
    lines,
    subtotal_amount: fromCents(subtotalCents),
    delivery_charge: fromCents(deliveryCents),
    discount_amount: fromCents(invoiceDiscountCents),
    total_amount: fromCents(totalCents),
  };
}
