function env(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Legal / trading name shown on POS receipts */
export function getPosBusinessName(): string {
  return env("NEXT_PUBLIC_POS_BUSINESS_NAME") ?? "Wholesale";
}

/** Shop / unit number printed on POS slips (e.g. market stall no.). Optional. */
export function getPosShopNumber(): string | undefined {
  const v = env("NEXT_PUBLIC_POS_SHOP_NUMBER");
  return v && v.length > 0 ? v : undefined;
}

export function getPosBusinessAddress(): string | undefined {
  return env("NEXT_PUBLIC_POS_BUSINESS_ADDRESS");
}

export function getPosBusinessPhone(): string | undefined {
  return env("NEXT_PUBLIC_POS_BUSINESS_PHONE");
}

export function getPosBusinessEmail(): string | undefined {
  return env("NEXT_PUBLIC_POS_BUSINESS_EMAIL");
}

export function getPosTaxId(): string | undefined {
  return env("NEXT_PUBLIC_POS_TAX_ID");
}

/** Short thank-you line above policy text */
export function getPosThankYouLine(): string {
  return env("NEXT_PUBLIC_POS_THANK_YOU") ?? "Thank you for your business.";
}

/**
 * Policy and legal copy (footer). Override via NEXT_PUBLIC_POS_POLICY_PARAGRAPHS
 * as JSON array of strings, e.g. `["Line 1","Line 2"]`, or use defaults.
 */
export function getPosPolicyParagraphs(): string[] {
  const raw = env("NEXT_PUBLIC_POS_POLICY_PARAGRAPHS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
        return parsed.filter((p) => p.trim().length > 0);
      }
    } catch {
      // fall through to defaults
    }
  }
  return [
    "This document is a draft sales record until the invoice is posted in the system.",
    "Prices and line totals include the discounts shown. Delivery is allocated across lines for reference.",
    "Returns and exchanges are subject to management approval and original invoice reference.",
    "Payment terms: as agreed with your account. For questions, contact us using the details above.",
  ];
}
