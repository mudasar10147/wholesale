import { onInventoryPosted } from "@/lib/inventory/inventoryEventBus";
import type { InventoryPostedEvent } from "@/lib/inventory/inventoryEvents";

let registered = false;

/**
 * Default no-op accounting subscriber. Replace or chain additional handlers
 * when a GL module is introduced — inventory never imports accounting directly.
 */
export function registerDefaultInventorySubscribers(): void {
  if (registered) return;
  registered = true;

  onInventoryPosted((_event: InventoryPostedEvent) => {
    // No-op: future AccountingService.onInventoryPosted(event) plugs in here.
  });
}
