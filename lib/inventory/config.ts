/**
 * Inventory engine rollout flags.
 * Override via env for rollback without redeploying business logic.
 *
 * - INVENTORY_ENGINE_WRITES=true  → dual-write inventory_transactions (Phase 2+)
 * - INVENTORY_SHADOW_MODE=true    → log shadow diffs only, no transaction docs (Phase 1)
 * - INVENTORY_NO_DIRECT_EDITS=true → block lot qty edit / sync in UI (Phase 3+)
 * - INVENTORY_LEGACY_REMOVED=true → deprecated APIs throw (Phase 4+)
 */
function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = typeof process !== "undefined" ? process.env[name] : undefined;
  if (raw === undefined) return defaultValue;
  return raw === "true" || raw === "1";
}

export const inventoryEngineConfig = {
  /** Write inventory_transactions on stock movements. */
  engineWritesEnabled: envFlag("NEXT_PUBLIC_INVENTORY_ENGINE_WRITES", true),
  /** Shadow mode: compute expected ledger rows without persisting. */
  shadowMode: envFlag("NEXT_PUBLIC_INVENTORY_SHADOW_MODE", false),
  /** Disallow direct lot qty edits and sync-from-lots in UI. */
  directLotEditsDisabled: envFlag("NEXT_PUBLIC_INVENTORY_NO_DIRECT_EDITS", true),
  /** Remove legacy sync/edit/sale paths. Default false for Phase 2 soak. */
  legacyRemoved: envFlag("NEXT_PUBLIC_INVENTORY_LEGACY_REMOVED", false),
} as const;

export function assertLegacyInventoryApiAllowed(apiName: string): void {
  if (inventoryEngineConfig.legacyRemoved) {
    throw new Error(
      `${apiName} has been removed. Use inventory transactions (stock adjustment, goods receipt, invoice) instead.`,
    );
  }
}
