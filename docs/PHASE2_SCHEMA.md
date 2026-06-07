# Phase 2 — Firestore schema (MVP)

Collection IDs and document fields match [PROJECT_SPEC.md](PROJECT_SPEC.md). Code mirrors this in [`lib/firestore/collections.ts`](../lib/firestore/collections.ts) and [`lib/types/firestore.ts`](../lib/types/firestore.ts).

Firestore creates a collection when the **first document** is written. Phase 3+ will add real writes; this document is the contract for field names and types.

## Collections

| Collection ID | Purpose |
|---------------|---------|
| `products` | Inventory items |
| `sales` | Sales records (references a product) |
| `expenses` | Business expenses |

## `products/{productId}`

| Field | Type | Required |
|-------|------|----------|
| `name` | string | yes |
| `category` | string | no |
| `cost_price` | number | yes |
| `sale_price` | number | yes |
| `stock_quantity` | number | yes |
| `created_at` | Timestamp | yes |
| `target_margin_percent` | number | no — gross margin target (% of sale price) |
| `pricing_mode` | string | no — `manual` or `automatic` |
| `pricing_updated_at` | Timestamp | no — last pricing-field change |

Document ID is the product identifier used elsewhere (spec “product_id”).

## `settings/pricing`

Single document for pricing defaults (admin-only).

| Field | Type | Required |
|-------|------|----------|
| `global_default_target_margin_percent` | number | yes |
| `category_templates` | map | yes — category name → `{ target_margin_percent, pricing_mode }` |
| `updated_at` | Timestamp | yes |

## `sales/{saleId}`

| Field | Type | Required |
|-------|------|----------|
| `product_id` | string | yes — must match a `products` document ID |
| `quantity` | number | yes |
| `sale_price` | number | yes |
| `total_amount` | number | yes |
| `date` | Timestamp | yes |

## `expenses/{expenseId}`

| Field | Type | Required |
|-------|------|----------|
| `title` | string | yes |
| `amount` | number | yes |
| `date` | Timestamp | yes |

## Relationships

- `sales.product_id` → `products/{product_id}`

## Timestamps

Use Firestore `Timestamp` (or `serverTimestamp()` when writing) for `created_at` and `date` fields.
