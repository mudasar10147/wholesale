export type CustomerEngagementTierSettings = {
  rollingWindowDays: number;
  premiumMinOrders: number;
  premiumMinSpend: number;
  premiumDiscountPercent: number;
  silverMinOrders: number;
  silverMinSpend: number;
  silverMaxSpend: number;
  silverDiscountPercent: number;
  bronzeOrders: number;
  bronzeMaxSpend: number;
};

export function defaultCustomerEngagementTierSettings(): CustomerEngagementTierSettings {
  return {
    rollingWindowDays: 30,
    premiumMinOrders: 4,
    premiumMinSpend: 50_000,
    premiumDiscountPercent: 0,
    silverMinOrders: 2,
    silverMinSpend: 20_000,
    silverMaxSpend: 50_000,
    silverDiscountPercent: 0,
    bronzeOrders: 1,
    bronzeMaxSpend: 20_000,
  };
}

export function validateCustomerEngagementTierSettings(
  settings: CustomerEngagementTierSettings,
): void {
  if (settings.rollingWindowDays < 7 || settings.rollingWindowDays > 365) {
    throw new Error("Rolling window must be between 7 and 365 days.");
  }
  if (settings.premiumMinOrders < 1) {
    throw new Error("Premium minimum orders must be at least 1.");
  }
  if (settings.silverMinOrders < 1) {
    throw new Error("Silver minimum orders must be at least 1.");
  }
  if (settings.bronzeOrders < 1) {
    throw new Error("Bronze order count must be at least 1.");
  }
  if (settings.silverMinSpend >= settings.silverMaxSpend) {
    throw new Error("Silver minimum spend must be less than silver maximum spend.");
  }
  if (settings.premiumDiscountPercent < 0 || settings.premiumDiscountPercent > 100) {
    throw new Error("Premium discount must be between 0 and 100.");
  }
  if (settings.silverDiscountPercent < 0 || settings.silverDiscountPercent > 100) {
    throw new Error("Silver discount must be between 0 and 100.");
  }
}

export function tierDiscountPercent(
  segment: "premium" | "silver" | "bronze" | "needs_follow_up" | "no_orders_yet",
  settings: CustomerEngagementTierSettings,
): number {
  if (segment === "premium") return settings.premiumDiscountPercent;
  if (segment === "silver") return settings.silverDiscountPercent;
  return 0;
}
