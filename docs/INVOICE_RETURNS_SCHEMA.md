# Invoice Returns — Firestore schema

Credit-note style returns linked to posted invoices. Code mirrors this in [`lib/firestore/collections.ts`](../lib/firestore/collections.ts) and [`lib/types/firestore.ts`](../lib/types/firestore.ts).

## Collections

| Collection ID | Purpose |
|---------------|---------|
| `invoice_returns` | Return header (customer, original invoice, settlement) |
| `invoice_return_items` | Return line items |
| `return_lot_restorations` | FIFO lot restore audit per consumption chunk (restock) |
| `return_lot_write_offs` | FIFO write-off audit for damaged/discarded qty (no stock restore) |

## `invoice_returns/{returnId}`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `return_number` | string | yes | Human-readable ID, e.g. `RET-20250605-1234` |
| `original_invoice_id` | string | yes | Posted invoice doc ID |
| `order_id` | string | yes | Copy of original invoice `order_id` |
| `customer_id` | string | yes | Copy of original invoice `customer_id` |
| `status` | string | yes | `draft`, `posted`, or `void` |
| `settlement_type` | string | yes | `reduce_balance` or `cash_refund` |
| `item_ids` | list | yes | Return line document IDs |
| `subtotal_amount` | number | yes | Sum of return line net amounts |
| `total_amount` | number | yes | Credit value (positive number) |
| `refund_amount` | number | yes | Financial settlement amount |
| `write_off_cogs_amount` | number | no | Sum of discard FIFO write-off at post |
| `return_reason` | string | no | |
| `notes` | string | no | |
| `posted_at` | Timestamp | no | Set when posted |
| `voided_at` | Timestamp | no | |
| `created_at` | Timestamp | yes | |
| `updated_at` | Timestamp | yes | |

## `invoice_return_items/{itemId}`

| Field | Type | Required |
|-------|------|----------|
| `return_id` | string | yes |
| `original_invoice_id` | string | yes |
| `original_invoice_item_id` | string | yes |
| `customer_id` | string | yes |
| `order_id` | string | yes |
| `product_id` | string | yes |
| `quantity_returned` | number | yes — positive int (`quantity_restock + quantity_discard`) |
| `quantity_restock` | number | yes — int ≥ 0 |
| `quantity_discard` | number | yes — int ≥ 0 |
| `unit_price` | number | yes |
| `line_discount` | number | yes |
| `line_delivery_charge` | number | yes |
| `line_total` | number | yes |
| `cogs_amount` | number | yes — restock FIFO COGS at post |
| `write_off_cogs_amount` | number | yes — discard FIFO COGS at post |
| `created_at` | Timestamp | yes |
| `updated_at` | Timestamp | yes |

Legacy rows without split fields: treat as `quantity_restock = quantity_returned`, `quantity_discard = 0`.

## `return_lot_restorations/{id}`

Immutable audit created at return post. Links return to original `lot_consumptions` row and records qty restored to each lot.

## `return_lot_write_offs/{id}`

Immutable audit for damaged/discarded return qty. Same shape as restorations but does not increase lot or product stock.

## Original invoice extensions

On `invoices/{invoiceId}` when returns are posted:

- `returned_amount` — cumulative posted return totals
- `return_ids` — list of posted return document IDs

Effective balance (computed in app, not stored):

```
effective_total = posted_total_amount - returned_amount
amount_due = max(0, effective_total - paid_amount)
```

## Sales offset rows

Posting a return creates negative `sales` rows with `sale_type: "return"`, `return_id`, and `original_invoice_id`.

- `cogs_amount` on the sale row is **negative restock COGS only** (reverses COGS for resellable units).
- Discard portion has no COGS reversal on the sale row; cost remains in original sale COGS with write-off audit on `return_lot_write_offs`.
