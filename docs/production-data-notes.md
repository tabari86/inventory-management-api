# Production data compatibility notes

Before deploying these model constraints against existing data:

- Review and clean mixed-case or otherwise nonconforming product SKUs before relying on uppercase SKU normalization and uniqueness.
- Check historical stock movements for movement types other than `GOODS_RECEIPT` and `GOODS_ISSUE` before enforcing the restricted enum.
- Treat expired refresh-token cleanup, JWT secret rotation, and removal or deactivation of unauthorized users as separate production operations.

These checks are deployment tasks; this repository does not claim they have already been performed on production data.

## Lifecycle/version migration prerequisite

Work Package 3 adds explicit aggregate versions, Product archive metadata,
derived Stock lifecycle guards, enriched movement fields, and a controlled
movement-version index. The application does not run this migration at startup
or during tests. Existing data must be inspected before lifecycle enforcement
receives traffic.

The migration reads the configured `MONGODB_URI` without printing it. Dry-run is
the default:

```bash
npm run migrate:phase1-lifecycle
```

Apply requires an explicit flag:

```bash
npm run migrate:phase1-lifecycle -- --apply
```

Do not run either command against an unintended environment. Review the safely
reported database name before apply; do not place credentials in logs or command
output.

## What the migration does

- Sets missing, non-integer, or less-than-one Product, Warehouse, and Stock
  `version` values to `1` without changing valid versions.
- Preserves parent status and does not infer old deactivation or archive dates.
- Derives `productLifecycleStatus` as `active`, `inactive`, or `archived` and
  `warehouseLifecycleStatus` as `active` or `inactive` when the referenced
  parent exists.
- Reports orphan Stock IDs and which parent is missing. It does not delete or
  invent a replacement parent. An unresolved guard remains absent and inventory
  enforcement therefore fails closed.
- Reports legacy movements missing integrity context and backfills only direct
  `productId`/`warehouseId` values safely derivable from their Stock relation.
- Does not invent `quantityBefore`, `quantityAfter`, `aggregateVersion`, or
  historical Product/Warehouse snapshots. Those facts cannot be reconstructed
  reliably for pre-cutover movements.
- Preflights duplicate numeric `(stockId, aggregateVersion)` candidates before
  any apply writes. If duplicates exist, apply aborts without creating the
  index or changing versions/guards.
- Creates the unique partial `{ stockId: 1, aggregateVersion: 1 }` index only
  for rows whose `aggregateVersion` is numeric. Legacy rows without the field
  remain compatible.

The script is idempotent and closes its own database connection. It never
deletes domain data.

## Deployment order

1. Prepare migration-compatible application code without enabling traffic that
   depends on populated guards.
2. Run the dry-run against the intended environment.
3. Investigate every orphan and duplicate candidate report.
4. Run apply only after the preflight is clean and approved.
5. Deploy or enable lifecycle enforcement according to the environment's
   rollout model.
6. Smoke-test Product archive, Stock creation, Goods Receipt, Goods Issue, and
   movement history.

The runtime deliberately fails closed when a Stock lifecycle guard is absent.
This order is therefore a migration prerequisite and is not claimed to be a
proven zero-downtime rollout.

## Rollback considerations

Rolling application code back does not reverse archive metadata, explicit
versions, guard fields, direct movement references, or the partial index. These
additive fields are compatible with the prior schemas, but legacy code could
again physically delete Products if it is redeployed; block or avoid legacy
DELETE traffic during rollback. Do not decrement versions or erase archive and
movement context. Index removal, if ever required, must be a separately reviewed
database operation after confirming no deployed writer relies on uniqueness.

## Idempotency index migration

Request idempotency uses a new `idempotencyrecords` collection and does not
require a document backfill. Production must not rely only on model auto-index
behavior; runtime auto-index creation is disabled for this model. The controlled
migration is dry-run by default:

```bash
npm run migrate:phase1-idempotency
```

Apply requires exactly the explicit flag:

```bash
npm run migrate:phase1-idempotency -- --apply
```

The migration inspects collection/index state and valid duplicate scopes. It
requires a unique index on
`{ actorType: 1, actorId: 1, operationId: 1, keyHash: 1 }` and a single-field
TTL index on `{ expiresAt: 1 }` with `expireAfterSeconds: 0`. Equivalent indexes
under alternate names are accepted. Incompatible reserved names, wrong key
order/direction, non-unique scope indexes, wrong TTL values, compound TTL
definitions, or duplicate valid scopes block apply. The tool never drops,
renames, repairs, deletes, or fabricates data.

The production rollout order is:

1. Deploy the idempotency migration tooling.
2. Run the dry-run against the intended database.
3. Inspect the safe summary and resolve blockers through a separately reviewed
   data/index operation.
4. Run the explicit apply command.
5. Verify both required index semantics.
6. Deploy the application code.
7. Smoke-test an original keyed mutation, replay, conflict, and an unkeyed call.

This repository does not claim that either production migration command has
been executed. Completed records expire seven days after completion, but the
MongoDB TTL monitor removes them asynchronously. A still-present expired record
remains authoritative; the key can be reused after physical removal. There is
no application cleanup job or request-time deletion.

## Audit/outbox index migration

AuditEvent and OutboxEvent begin recording at runtime cutover. The controlled
migration creates only their required indexes; it does not backfill or fabricate
historical events and does not modify domain or event documents. Runtime
automatic index creation is disabled for both models.

Dry-run is the default:

```bash
npm run migrate:phase1-audit-outbox
```

Apply requires exactly the explicit flag:

```bash
npm run migrate:phase1-audit-outbox -- --apply
```

The migration inspects both collection and index states, validates ordered keys,
directions, uniqueness, `prepareUnique`, sparse/partial definitions, collation,
hidden and TTL semantics, and accepts a compatible alternate index name. An
incompatible reserved name always blocks execution. Any TTL index on either
collection is rejected. Before the first index write, apply preflights duplicate
Audit IDs, duplicate Outbox event IDs, and duplicate Outbox aggregate
type/ID/version identities. It never drops, renames, repairs, deletes, or
backfills.

Deployment order:

1. Deploy or locally check the audit/outbox migration tooling.
2. Run dry-run against the intended target database.
3. Inspect collection existence, duplicate counts, and the complete index plan.
4. Resolve blockers through a separately reviewed data/index operation.
5. Run the explicit `--apply` command.
6. Rerun dry-run and verify every required index is present and compatible.
7. Deploy runtime code and run production mutation, no-op, and replay smoke tests.

Codex did not execute this migration against production. No historical events
are backfilled; event history begins at cutover. Pending OutboxEvents accumulate
until a future delivery worker is deliberately designed and deployed. Audit
retention and delivered-Outbox retention remain deferred policy decisions; no
TTL or cleanup task is included.
