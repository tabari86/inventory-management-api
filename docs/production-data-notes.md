# Phase 1 migration runbook

This is the authoritative runbook for Phase 1 database changes. The application
never runs these scripts at startup, and production connections use
`autoIndex: false`.

Run the migrations in this order:

1. `phase1LifecycleVersion`
2. `phase1IdempotencyIndexes`
3. `phase1AuditOutboxIndexes`
4. `phase1ApiReadIndexes`

For every target, inject `MONGODB_URI` through the operator environment, run
dry-run first, verify the exact target database from the safe summary, resolve
every blocker, and apply only after approval. Never paste or print a connection
string or credentials in documentation, chat, tickets, or command output. Rerun
dry-run after apply and independently inspect the resulting indexes. Maintain a
current backup and an environment-specific rollback decision; these additive
scripts do not provide automatic down migrations.

Before deploying these model constraints against existing data:

- Review and clean mixed-case or otherwise nonconforming product SKUs before relying on uppercase SKU normalization and uniqueness.
- Check historical stock movements for movement types other than `GOODS_RECEIPT` and `GOODS_ISSUE` before enforcing the restricted enum.
- Treat expired refresh-token cleanup, JWT secret rotation, and removal or deactivation of unauthorized users as separate production operations.

These checks are deployment tasks. Supplied production evidence and local WP8
verification are separated under **Production evidence boundary** below.

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

Production execution of this migration was not independently established in
this WP8 session. Completed records expire seven days after completion, but the
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

## API read-index migration and v1 compatibility

WP7 makes `/api/v1` canonical while retaining `/api` as a temporary runtime
alias with no removal date. Legacy Product, Warehouse, Stock, and StockMovement
lists are now bounded and callers must follow `X-Next-Cursor`. Canonical callers
receive the cursor in `meta.nextCursor`. Cursor reads are deterministic for a
stable dataset but are not snapshot-isolated across concurrent writes; only
`createdAt` sorting is supported, and arbitrary search/projection is rejected.
Canonical v1 inventory mutation data is also presented through explicit public
DTO allowlists after fresh execution or replay, so Mongoose `__v` and other
persistence-only fields are excluded without changing legacy response bodies or
stored idempotency records.

Production startup disables automatic Mongoose index construction. Required
read indexes are owned by a dry-run-first migration:

```bash
npm run migrate:phase1-api-read-indexes
npm run migrate:phase1-api-read-indexes -- --apply
```

The migration has two distinct index checks. Its prerequisite preflight verifies
the schema-derived Product `{ sku: 1 }` unique index, Warehouse `{ code: 1 }`
unique index, ordered Stock `{ productId: 1, warehouseId: 1 }` unique index, and
ordered StockMovement `{ stockId: 1, aggregateVersion: 1 }` unique index with
the exact numeric `aggregateVersion` partial filter. Index names are not the
source of truth, so a differently named semantic equivalent is accepted.
Missing, non-unique, wrongly ordered, or otherwise incompatible prerequisites
are blocking and are never created, dropped, rebuilt, renamed, or repaired by
this migration. Operators must investigate and run the owning historical
migration or follow an explicitly approved remediation plan.

The second check classifies the WP7 bounded-read indexes and reports missing or
non-Date `createdAt` values. A missing required model-derived collection is also
blocking: dry-run and apply fail non-zero, no collection is created merely to
attach read indexes, and apply creates no WP7 index while any preflight blocker
exists. Blocking rows are never rewritten or assigned fabricated timestamps.
With a clean preflight, apply creates only absent compatible WP7 indexes, never
drops/rebuilds an index, never changes documents, and introduces no TTL index.
Reapplying is idempotent.

Required index names and ordered keys are:

- Products: `idx_products_non_archived_created_at_id`
  `(archivedAt, createdAt, _id)` and
  `idx_products_non_archived_status_created_at_id`
  `(archivedAt, status, createdAt, _id)`.
- Warehouses: `idx_warehouses_created_at_id` `(createdAt, _id)` and
  `idx_warehouses_status_created_at_id` `(status, createdAt, _id)`.
- Stocks: `idx_stocks_created_at_id`,
  `idx_stocks_product_created_at_id`,
  `idx_stocks_warehouse_created_at_id`, and
  `idx_stocks_status_created_at_id`, each ending in `(createdAt, _id)`.
- Stock movements: `idx_stock_movements_created_at_id` plus
  `idx_stock_movements_{stock|product|warehouse|type|reference}_created_at_id`.

The prerequisite unique SKU, warehouse-code, Product/Warehouse Stock
relationship, and StockMovement aggregate-version integrity indexes remain
owned by their schemas and historical migrations. The WP7 tool verifies but
does not repair them. The minimal read set intentionally does not create every
multi-filter permutation.

Production rollout order, to be performed independently of this implementation:

1. Independently review the runtime, index plan, migration, and tests.
2. Commit the reviewed change.
3. Run the production migration in dry-run mode and resolve any blocker through
   a separately reviewed data/index operation.
4. Run the explicit `--apply` command and verify every index.
5. Deploy the application.
6. Smoke-test health plus authenticated canonical and legacy reads/mutations,
   including a cross-version idempotent replay.

No production database, MongoDB Atlas database, migration, index creation,
deployment, commit, or push was accessed or performed in this WP8 session.

## Procedure acceptance criteria

The detailed behavior above and the following acceptance criteria must both be
reviewed before each apply.

### Lifecycle/version acceptance

- **Affected collections:** `products`, `warehouses`, `stocks`, and
  `stockmovements`.
- **Prerequisites:** read/update/index privileges, a reviewed backup, no
  competing migration, and an operational decision for every orphan Stock.
- **Expected dry-run:** invalid version counts, orphan relationships, legacy
  movement state, duplicate numeric `(stockId, aggregateVersion)` candidates,
  and owned-index compatibility; no write.
- **Expected apply:** converge invalid aggregate versions to `1`, derive guards
  for resolvable parents, add only derivable direct movement references, and
  create the compatible partial unique index when absent.
- **Blocking conditions:** duplicate numeric movement versions or an
  incompatible owned index stop apply before updates. Orphans are not deleted
  or fabricated and block safe lifecycle rollout because runtime guards fail
  closed.
- **Re-run and verification:** re-running is idempotent. Run post-apply dry-run,
  confirm applicable invalid counts are zero, review every orphan/legacy count,
  inspect partial-index semantics, and smoke-test lifecycle, Stock creation,
  receipt, issue, and movement reads.
- **Rollback limitation:** do not decrement versions or erase lifecycle/history
  fields. Index removal is a separate reviewed operation.

### Idempotency-index acceptance

- **Affected collection:** `idempotencyrecords`.
- **Prerequisites:** lifecycle migration complete, index privileges, and review
  of existing records for duplicate valid scopes.
- **Expected dry-run:** collection existence, duplicate-scope count, and state
  of the ordered unique scope index and single-field TTL index; no write.
- **Expected apply:** create only missing compatible indexes. If the collection
  is absent, MongoDB may create it with the first index; documents are not
  modified.
- **Blocking conditions:** duplicate valid scopes, incompatible reserved or
  related indexes, wrong uniqueness/key order, or wrong TTL semantics.
- **Re-run and verification:** semantically equivalent alternate names are
  accepted. Run post-apply dry-run, inspect both index definitions, and test an
  original keyed mutation, replay, conflict, and unkeyed mutation.
- **Rollback limitation:** removing either index can permit duplicate execution
  or prevent expiry cleanup and requires a separate approved procedure.

### Audit/outbox-index acceptance

- **Affected collections:** `auditevents` and `outboxevents`.
- **Prerequisites:** idempotency migration complete, index privileges, and
  review for duplicate Audit IDs, Outbox event IDs, and aggregate
  type/ID/version identities.
- **Expected dry-run:** collection existence, duplicate-group counts, any TTL
  indexes, and all owned-index states; no write.
- **Expected apply:** create only missing compatible indexes. First index
  creation can create an absent collection, but no historical event is inserted.
- **Blocking conditions:** any duplicate identity, incompatible reserved or
  related index, or any TTL index on either collection.
- **Re-run and verification:** compatible alternate names are accepted. Run
  post-apply dry-run, inspect every index option, and smoke-test a mutation,
  no-op, replay, and expected event counts.
- **Rollback limitation:** committed events are business records. Index removal
  or retention changes require separate review. Pending OutboxEvents accumulate
  because Phase 1 has no delivery worker.

### API read-index acceptance

- **Affected collections:** `products`, `warehouses`, `stocks`, and
  `stockmovements`.
- **Prerequisites:** the prior three migrations complete; all four collections
  exist; every row has a BSON Date `createdAt`; and the Product SKU, Warehouse
  code, Stock relationship, and StockMovement aggregate-version integrity
  indexes are semantically compatible.
- **Expected dry-run:** collection/data integrity, prerequisite index state, and
  every read-index plan; no collection or index creation.
- **Expected apply:** create only absent compatible read indexes; never rewrite
  documents or repair prerequisites.
- **Blocking conditions:** missing collection, invalid/missing `createdAt`,
  missing or incompatible prerequisite, or incompatible reserved/related read
  index. Any blocker prevents all read-index creation.
- **Re-run and verification:** re-running is idempotent. Run post-apply dry-run,
  inspect ordered definitions, and test first/next pages in both directions and
  supported filters on `/api/v1` and `/api`.
- **Rollback limitation:** dropping read indexes does not roll back cursor
  contracts and can cause query regressions; require measured query-plan
  evidence and separate approval.

## Production evidence boundary

For the baseline supplied with WP8, the lifecycle/version and API read-index
migrations were externally reported as applied and verified. This is evidence
provided by the repository owner, not verification performed by Codex in this
session. The production state of the idempotency and audit/outbox migrations was
not independently established here. No remote database connection or migration
was attempted during WP8.

## Operational runtime deployment

Work Package 6 changes process startup, health reporting, shutdown, request
context validation, and standard-output logging only. It adds no model, schema,
index, collection, backfill, or production data change, and no migration is
required.

Render remains compatible with the existing `healthCheckPath: /health` setting;
that path is the legacy liveness alias and does not depend on MongoDB. The
canonical liveness path is `/health/live`. Canonical readiness is
`/health/ready`, while `/api/ready` is a compatibility readiness alias added by
WP6. Readiness depends on completed startup, an active Mongoose connection,
accepted traffic, and shutdown not having started.

The server now awaits MongoDB before listening. If required configuration or
database startup fails, no listener remains active and the process exits
non-zero after a sanitized structured log. Render can therefore restart the
failed instance according to its platform policy without receiving a false
ready signal.

Render sends `SIGTERM` during shutdown. `SIGTERM` and `SIGINT` both make the
application unready before stopping new traffic, then allow the HTTP server to
close before closing Mongoose. The sequence is single-flight and bounded to ten
seconds. A timeout force-closes supported HTTP connections, attempts database
cleanup once, and exits non-zero; requests are not guaranteed to complete past
that bound.

Application lifecycle, error, and HTTP terminal records are structured JSON
written to standard output for the hosting platform to collect. The application
does not persist logs, ship them remotely, or claim metrics, alerting, or
distributed tracing. Allowlisted construction and logger redaction exclude
credentials, tokens, bodies, query values, database URIs, raw idempotency keys,
user profile fields, and production stack traces.

### Remaining operational limits

- Render still checks `/health`, which is liveness rather than readiness, so
  the platform health check does not directly evaluate MongoDB readiness.
- Signal handlers are registered after startup succeeds. A termination signal
  during the database connection or retry window does not use the normal
  graceful-shutdown orchestrator.
- Synchronous standard-output logging can add latency at unusually high log
  volume.
- Pending OutboxEvents continue accumulating until a separately approved
  delivery worker exists.
