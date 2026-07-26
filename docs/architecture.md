# Architecture Notes

This document describes the main backend architecture and business rules of the Inventory Management API.

The goal is to keep the project close to a realistic inventory and warehouse management backend, without adding unnecessary complexity.

## Domain Overview

The project is built around four main business concepts:

```text
Product
Warehouse
Stock
StockMovement
```

Products and warehouses are master data.
Stock connects products and warehouses.
Stock movements describe why and how inventory quantities change.

## Core Data Relationship

```text
Product
   │
   ▼
 Stock
   ▲
   │
Warehouse
```

A stock record represents the quantity of one product in one warehouse.

The combination of `productId` and `warehouseId` should be unique.
This prevents duplicate stock records for the same product in the same warehouse.

## Stock Movement Principle

Stock quantity must not be changed directly.

All stock changes should happen through business operations such as:

* Goods receipt
* Goods issue
* Stock adjustment
* Stock transfer

Each operation should create a stock movement record.

This keeps stock changes traceable and prevents unexplained quantity changes.

## Product Lifecycle

Products use `status: active | inactive` plus terminal archive metadata. Active
Products may participate in Stock creation and inventory mutations. Inactive
Products remain visible and referenced, block those mutations, and may be
reactivated. The deprecated single and bulk DELETE routes archive only inactive
Products by setting `archivedAt`, `archivedBy`, and optional `archiveReason`.
Archive retains the document and unique SKU but hides it from normal Product
reads and updates. There is no restore or physical-delete API.

Meaningful Product commands increment explicit `version` once. Repeated
already-applied transitions do not increment it. Deactivation metadata is set
on active-to-inactive and cleared on reactivation.

## Warehouse Lifecycle

Warehouses can be created, listed, updated and deactivated.

Inactive Warehouses remain readable, block Stock creation and inventory
mutations, and may be reactivated. Status transitions set or clear deactivation
metadata and increment explicit `version` once; no-op transitions do not.

Warehouse deletion is intentionally not implemented.

Warehouses are connected to stock records, goods receipts, goods issues and movement history.
Deleting a warehouse would make historical inventory data unreliable.

## Business Identifiers

Some fields are treated as business identifiers.

Examples:

* Product SKU
* Warehouse code

Warehouse codes are stored in uppercase and are not changed through the update endpoint.

This keeps warehouse references stable for future stock records, reports and integrations.

## Current Backend Structure

```text
Routes
  ↓
Authentication / RBAC
  ↓
Validators
  ↓
Thin Controllers
  ↓
Inventory or Stock Application Service
  ↓
Transaction Helper for Inventory Mutations
  ↓
Mongoose Models
  ↓
MongoDB
```

Product/Warehouse mutations, goods receipt, goods issue, and Stock setup writes use application services that
accept plain JavaScript input and do not depend on Express request or response
objects. Their controllers translate HTTP input and output only. Existing Stock
read operations remain in the Stock controller.

Expected business failures from these services use typed domain errors. The
global error handler maps them to the existing status codes and message-only
response bodies, so the public API contract remains unchanged.

Product and Warehouse lifecycle services transactionally update the parent and
propagate derived lifecycle state to related Stock guards:

```text
Product/Warehouse lifecycle command
  -> compare-and-swap parent version
  -> set or clear lifecycle metadata
  -> propagate Stock guard and increment affected Stock versions
  -> commit
```

Stock creation reads active parent versions and conditionally increments each
distinct parent version before inserting Stock. That increment records the new
aggregate relationship and makes creation conflict with concurrent parent
deactivation.

Goods receipt and goods issue run through a reusable transaction helper. Each
request uses one MongoDB session, and every authoritative Stock and
StockMovement read or write is attached to that session. Stock changes and
movement records therefore commit atomically. Bulk receipt and issue requests
use one transaction for the complete request and are all-or-nothing. The former
manual compensation updates and movement deletes are no longer used.

```text
Inventory transaction
  -> load Stock, Product, and Warehouse in one session
  -> require active authoritative parents, active Stock, and active guards
  -> guarded quantity plus Stock.version update
  -> enriched StockMovement with exact aggregateVersion
  -> commit
```

Both parent reads and derived Stock guards are required. Inventory mutation and
lifecycle propagation write the same Stock document, turning concurrent parent
lifecycle changes into a write conflict instead of permitting write skew.

Transactions require a replica-set or equivalent transaction-capable MongoDB
topology. Tests use a single-node `MongoMemoryReplSet`, and local Docker Compose
uses MongoDB 8 with the single-node replica set `rs0`.

Explicit `version` on Product, Warehouse, and Stock is the domain aggregate
revision; Mongoose `__v` is not. Product/Warehouse mutations always use an
internal compare-and-swap. The current API additionally accepts optional
`expectedVersion`; omission remains backward compatible and can still permit
last-write-wins. Mandatory preconditions are deferred to a versioned contract.

Transaction callback state and movement calculations are attempt-local, so a
driver callback retry does not accumulate versions or response arrays.

## Request Context

The first application middleware generates a new `X-Request-ID` UUID for every
HTTP attempt and never trusts an inbound request ID. `X-Correlation-ID` accepts
one 1-128 character value matching `^[A-Za-z0-9._:-]+$`; otherwise the request
fails with 400. When omitted, correlation defaults to the request ID. Both
headers are written before parsing, authentication, or routing so success and
error paths carry them.

The context passed explicitly through controllers and application services is:

```text
{ requestId, correlationId, source: "http-api", actor: { type: "user", id } }
```

Authentication supplies the actor from the validated User record. The context
does not contain raw headers, JWTs, roles, email, or names. There is no
AsyncLocalStorage or mutable global request state. This boundary is ready for
future AuditEvent and OutboxEvent work, but neither event type is implemented.

## Inventory Mutation Idempotency

Every exposed Product, Warehouse, Stock, Goods Receipt, and Goods Issue
mutation maps to one explicit versioned business operation ID. GET, auth, user,
Swagger, health, and read-only StockMovement operations do not enter the
idempotency executor.

After authentication, RBAC, validation, and normalization, controllers build a
plain command containing the operation ID, normalized path parameters,
semantic query parameters, and normalized body. `canonical-json-v1` recursively
sorts plain-object keys, preserves array order and JSON types, normalizes
ObjectIds/dates, and rejects unsupported or circular values. SHA-256 hashes both
the canonical command and the raw opaque key; the raw key is never persisted.

The unique scope is `(actorType, actorId, operationId, keyHash)`. For a keyed
original execution one transaction inserts an internal `processing` record,
runs the session-bound domain operation and movement writes, constructs a plain
JSON response snapshot, enforces the 1 MiB limit, and changes the record to
`completed`. A failed transaction commits no record, and no committed `failed`
state exists. Public service wrappers continue to own the normal transaction
when no key is supplied; keyed execution calls the same internal work with the
executor-owned session, avoiding nested transactions.

MongoDB's unique compound index prevents concurrent duplicate commits. A loser
resolves the committed record in at most three bounded attempts. Matching
request hashes replay the exact status/body without another domain write;
different hashes return 409. Authentication and RBAC always run before replay.
Completed records expire seven days after completion through a single-field TTL
index. TTL removal is asynchronous; until removal the stored record remains
authoritative. Runtime auto-index creation is disabled for the record model; the
dry-run-first migration owns production index creation. No Redis lock,
application cleanup worker, lease, or heartbeat is used.

## Stock Aggregate Design

Stock is the association between Product and Warehouse. Its integrity fields are:

```text
productId
warehouseId
quantity
status
version
productLifecycleStatus
warehouseLifecycleStatus
```

Lifecycle guards are derived transactionally from parents and are not separate
business truth. Missing legacy guards fail closed until migration. Guard changes
do not overwrite Stock's own status. Quantity is updated only by controlled
inventory operations.

There should be no direct endpoint such as:

```http
PATCH /api/stocks/:id
```

for manually changing quantity.

## Stock Movement Design

Stock movements document inventory changes. New writes include:

```text
productId
warehouseId
type
quantity
reference
reason
quantityBefore
quantityAfter
aggregateVersion
productSnapshot { sku, name }
warehouseSnapshot { code, name }
createdAt
```

Current movement types:

```text
GOODS_RECEIPT
GOODS_ISSUE
```

Direct parent references avoid dependence on nested Stock population. Snapshots
remain immutable after parent rename or archive. Repeated Stock IDs in a bulk
request retain input order and receive sequential before/after quantities and
aggregate versions. Additive schema fields remain optional so legacy rows stay
readable; historical values predating the cutover are not fabricated.

The controlled migration creates a unique partial index on
`{ stockId, aggregateVersion }` for numeric aggregate versions only, after its
duplicate-candidate preflight succeeds.

## Development Principle

The project follows a business-first approach.

Before adding a feature, the main question is:

```text
Would this behavior still make sense in a real inventory system?
```

If the answer is no, the feature should not be added only to make the project larger.

---

## Guiding Principle

The project is designed around business processes instead of CRUD operations.

Business rules define how data changes.

The API should reflect real inventory workflows rather than direct database manipulation.

Whenever possible, inventory changes should be represented as business transactions instead of simple field updates.
