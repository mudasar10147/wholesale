import type { InventoryPostedEvent } from "@/lib/inventory/inventoryEvents";

type InventoryEventHandler = (event: InventoryPostedEvent) => void | Promise<void>;

const handlers: InventoryEventHandler[] = [];

/** Register a subscriber (e.g. future accounting module). Inventory never imports accounting. */
export function onInventoryPosted(handler: InventoryEventHandler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  };
}

export async function emitInventoryPosted(event: InventoryPostedEvent): Promise<void> {
  for (const handler of handlers) {
    await handler(event);
  }
}
