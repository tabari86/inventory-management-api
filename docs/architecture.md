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

Products can be created, listed, updated, deactivated and deleted.

A product can only be deleted after it has been deactivated.

This rule helps prevent accidental deletion of active product data.

## Warehouse Lifecycle

Warehouses can be created, listed, updated and deactivated.

Warehouse deletion is intentionally not implemented.

Warehouses may later be connected to stock records, goods receipts, goods issues and movement history.
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
Controllers
  ↓
Models
  ↓
Database
```

The current structure is intentionally simple.

A separate service layer may be added later when stock operations and movement logic become more complex.

## Future Stock Design

The planned stock model will work as an association between product and warehouse.

Expected fields:

```text
productId
warehouseId
quantity
```

The quantity field may be stored for performance, but it should only be updated by controlled business operations.

There should be no direct endpoint such as:

```http
PATCH /api/stocks/:id
```

for manually changing quantity.

## Future Stock Movement Design

Stock movements will document inventory changes.

Expected fields may include:

```text
productId
warehouseId
type
quantity
reference
reason
createdAt
```

Possible movement types:

```text
GOODS_RECEIPT
GOODS_ISSUE
TRANSFER_IN
TRANSFER_OUT
ADJUSTMENT
```

The exact model will be finalized when stock logic is implemented.

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