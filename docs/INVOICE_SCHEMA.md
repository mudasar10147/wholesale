# Invoice System — Firestore schema

Schema contract for customer + invoice features. Code mirrors this in [`lib/firestore/collections.ts`](../lib/firestore/collections.ts) and [`lib/types/firestore.ts`](../lib/types/firestore.ts).

## Collections

| Collection ID | Purpose |
|---------------|---------|
| `customers` | Customer master records |
| `invoices` | Invoice headers (customer, order ID, status, totals) |
| `invoice_items` | Invoice line items tied to invoice + product |

## `customers/{customerId}`

| Field | Type | Required |
|-------|------|----------|
| `name` | string | yes |
| `phone` | string | no |
| `email` | string | no |
| `address` | string | no |
| `is_active` | boolean | yes |
| `created_at` | Timestamp | yes |
| `updated_at` | Timestamp | yes |

## `invoices/{invoiceId}`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `customer_id` | string | yes | must match a `customers` document ID |
| `order_id` | string | yes | unique business-facing order/invoice number |
| `status` | string | yes | one of `draft`, `posted`, `void` |
| `subtotal_amount` | number | yes | sum of line totals before header adjustments |
| `discount_amount` | number | yes | invoice-level discount |
| `delivery_charge` | number | yes | invoice-level delivery/transport charge |
| `total_amount` | number | yes | final payable total |
| `notes` | string | no | free text |
| `posted_at` | Timestamp | no | present when status is `posted` |
| `created_at` | Timestamp | yes | |
| `updated_at` | Timestamp | yes | |

## `invoice_items/{invoiceItemId}`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `invoice_id` | string | yes | must match an `invoices` document ID |
| `order_id` | string | yes | copy of parent `invoices.order_id` for fast lookups |
| `customer_id` | string | yes | copy of parent `invoices.customer_id` for reporting |
| `product_id` | string | yes | must match a `products` document ID |
| `quantity` | number | yes | positive whole number |
| `unit_price` | number | yes | sale price used for this line |
| `line_discount` | number | yes | line-level discount (0 if none) |
| `line_delivery_charge` | number | yes | allocated delivery charge (0 if none) |
| `line_total` | number | yes | line net amount |
| `created_at` | Timestamp | yes | |
| `updated_at` | Timestamp | yes | |

## Required relationships

- `invoices.customer_id` → `customers/{customerId}`
- `invoice_items.invoice_id` → `invoices/{invoiceId}`
- `invoice_items.product_id` → `products/{productId}`
- `invoice_items.customer_id` should equal parent `invoices.customer_id`
- `invoice_items.order_id` should equal parent `invoices.order_id`

## Totals contract

Recommended formula:

- `subtotal_amount = sum(invoice_items.line_total)`
- `total_amount = subtotal_amount - discount_amount + delivery_charge`

## Timestamp contract

Use Firestore `Timestamp` values. For writes, prefer `serverTimestamp()` on create/update.
