# Inventory migration runbook

Production-safe rollout for the ERP inventory transaction engine. **Data integrity over new features.**

## Before any migration

### 1. Backup Firestore

```bash
# Full export (recommended)
gcloud firestore export gs://YOUR_BUCKET/backups/inventory-$(date +%Y%m%d) \
  --project=wholesale-b4ff9

# Or export specific collections via Admin SDK (see scripts/inventory/export-baseline.mjs)
```

Collections to include:

- `products`
- `stock_lots`
- `lot_consumptions`
- `invoice_item_cogs`
- `invoices`
- `invoice_items`
- `inventory_discards`, `inventory_discard_items`, `inventory_discard_lots`
- `return_lot_restorations`, `return_lot_write_offs`

Store the backup path in the migration manifest (`schema_migrations`).

### 2. Run validation (read-only)

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json npm run validate:inventory
```

Review `reports/inventory-validation-*.json`. **Do not proceed** if unexpected new errors appear after a phase.

### 3. Capture baseline fixture (optional, for CI)

```bash
npm run inventory:export-baseline
```

Commits anonymized subset to `test/fixtures/inventory-baseline/` for parity tests.

## Schema migrations

All migrations support `--dry-run` (default) and `--apply`.

```bash
# Dry run (no writes)
node scripts/migrations/run.mjs 001

# Apply after backup
node scripts/migrations/run.mjs 001 --apply --backup-path gs://...

# Rollback
node scripts/migrations/run.mjs 001 --rollback
```

| ID | Description |
|----|-------------|
| 001 | Create default `warehouses/default` document |
| 002 | Add `warehouse_id: default` to lots missing it (additive only) |

**Forbidden:** migrations never change `stock_quantity`, `qty_remaining`, COGS, or delete business documents.

## Rollback

1. Revert feature flags in `.env.local`:
   - `NEXT_PUBLIC_INVENTORY_LEGACY_REMOVED=false`
   - `NEXT_PUBLIC_INVENTORY_NO_DIRECT_EDITS=false`
2. Redeploy previous Firestore rules if Phase 3 rules were deployed.
3. Restore from backup if data corruption occurred (last resort).

## Phase gates

| Phase | Gate |
|-------|------|
| 1 | Validation baseline reviewed; migrations 001–002 dry-run OK |
| 2 | Parity tests pass; no new validation errors after soak |
| 3 | Production validation errors stable; stock adjustments tested |
| 4 | 30 days green validation; legacy removal approved |

## Stock corrections

Never use “sync stock from lots”. For mismatches flagged in validation:

1. Investigate root cause (legacy sale, manual lot edit, etc.)
2. Post a **Stock adjustment** with required reason from the product lots modal
3. Re-run validation for that product
