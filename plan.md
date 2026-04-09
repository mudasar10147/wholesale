# Invoice System Expansion Plan

This roadmap adds invoices, customer management, and FIFO-based profitability in three phases.

## Phase 1: Customer and Invoice Foundation

### Objective
Establish core invoice entities with customer linkage and order tracking.

### Tasks
1. Define Firestore schema for `customers`, `invoices`, and `invoice_items` with required fields (`customer_id`, `order_id`, invoice status, totals).
2. Create customer CRUD screens (create, list, edit, soft-delete/archive) with validation and clear error handling.
3. Build invoice creation flow that requires selecting a customer and auto-generates a unique `order_id`/invoice number.
4. Attach invoice line items to products with quantity, unit sale price, discount, delivery charge allocation, and line total calculations.
5. Update security rules and typed model contracts so only valid, complete invoice/customer data can be written.

## Phase 2: Stock Integration and Financial Tracking

### Objective
Connect invoices to inventory movement and accurate customer-level analytics.

### Tasks
1. Replace direct sale recording with invoice posting transaction that decrements stock based on invoice items.
2. Store immutable financial snapshots on invoice posting (unit cost at posting strategy placeholder, unit sale, discounts, delivery, subtotal, grand total).
3. Add customer ledger views showing total purchased, paid/unpaid amounts, total discount, delivery charges, and net revenue contribution.
4. Update dashboard/report services to include invoice-based profit/loss and customer-wise profitability summaries.
5. Add invoice lifecycle actions (draft, posted, canceled/void) with stock-safe rules preventing invalid reversals.

## Phase 3: FIFO Costing Engine and Profit Accuracy

### Objective
Implement first-in-first-out cost calculation for true COGS and margin reporting.

### Tasks
1. Introduce inventory lot/batch records per stock-in event (`lot_id`, product, qty_in, qty_remaining, unit_cost, received_at).
2. Build FIFO allocation logic during invoice posting to consume oldest available lots first and persist lot-consumption rows.
3. Persist computed COGS per invoice line from FIFO consumption and lock it for historical accuracy even if future costs change.
4. Implement reversal logic for canceled invoices that restores consumed quantities back to the correct lots in reverse-safe order.
5. Add FIFO audit/report pages (lot aging, remaining stock valuation, per-invoice gross margin) plus reconciliation checks.

## Delivery Notes

- Keep existing app operational while migrating from simple sales to invoices.
- Prefer additive rollout: invoices run in parallel first, then retire legacy sales paths after validation.
- Validate each phase with lint/build plus scenario tests (discounts, delivery charges, partial stock lots, invoice cancel/repost).
