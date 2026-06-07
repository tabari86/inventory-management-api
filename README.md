# Inventory Management API

![Node.js](https://img.shields.io/badge/Node.js-Backend-green)
![Express](https://img.shields.io/badge/Express.js-API-lightgrey)
![MongoDB](https://img.shields.io/badge/MongoDB-Database-brightgreen)
![Status](https://img.shields.io/badge/Status-In%20Development-blue)

A backend API for managing products, warehouses and stock movements in a simple inventory management system.

## Project Goal

The goal of this project is to model a realistic inventory and warehouse backend instead of implementing simple CRUD operations.

Inventory changes are handled through business processes that create immutable stock movement records while maintaining the current stock state.

---

## Tech Stack

* Node.js
* Express.js
* MongoDB
* Mongoose
* dotenv
* Nodemon

---

## Features

Current features:

* Express server setup
* MongoDB connection using environment variables

* Product management API
* Warehouse management API
* Stock management API

* Stock movement tracking API
* Goods receipt workflow
* Goods issue workflow

* Product and warehouse validation
* Duplicate SKU validation
* Duplicate warehouse code validation
* Duplicate stock prevention

* Stock quantity management through business processes
* Basic API error handling

Planned features:

* Swagger API documentation
* Docker setup

---

## API Endpoints

### Products

| Method | Endpoint                       | Description                |
| -------|--------------------------------|----------------------------|
| POST   | `/api/products`                | Create a new product       |
| GET    | `/api/products`                | Retrieve all products      |
| GET    | `/api/products/:id`            | Retrieve a single product  |
| PATCH  | `/api/products/:id`            | Update product information |
| PATCH  | `/api/products/:id/deactivate` | Deactivate a product       |
| DELETE | `/api/products/:id`            | Delete an inactive product |

### Warehouses

| Method | Endpoint                         | Description                  |
| -------|----------------------------------|------------------------------|
| POST   | `/api/warehouses`                | Create a new warehouse       |
| GET    | `/api/warehouses`                | Retrieve all warehouses      |
| GET    | `/api/warehouses/:id`            | Retrieve a single warehouse  |
| PATCH  | `/api/warehouses/:id`            | Update warehouse information |
| PATCH  | `/api/warehouses/:id/deactivate` | Deactivate a warehouse       |

Warehouse deletion is intentionally not implemented because warehouses may later be connected to stock records and movement history.

### Stocks

| Method | Endpoint          | Description                                       |
|--------|-------------------|---------------------------------------------------|
| POST   | `/api/stocks`     | Create a stock record for a product and warehouse |
| GET    | `/api/stocks`     | Retrieve all stock records                        |
| GET    | `/api/stocks/:id` | Retrieve a single stock record                    |


Stock quantity is not updated directly through the stock API. Quantity changes will later be handled through stock movement workflows.


### Goods Receipt

| Method  | Endpoint              | Description                               |
|---------|-----------------------|-------------------------------------------|
| POST    | `/api/goods-receipts` | Receive goods and increase stock quantity |


### Goods Issue

| Method  | Endpoint            | Description                             |
|---------| --------------------|-----------------------------------------|
| POST    | `/api/goods-issues` | Issue goods and decrease stock quantity |

---

## Example Requests

### Create product

```json
{
  "sku": "LAPTOP-001",
  "name": "Dell Latitude 7450",
  "description": "Business laptop",
  "unit": "piece"
}
```

### Create warehouse

```json
{
  "code": "WH-STU",
  "name": "Main Warehouse",
  "description": "Primary warehouse for incoming and outgoing goods"
}
```

### Update warehouse

```json
{
  "name": "Main Warehouse Germany",
  "description": "Updated warehouse description"
}
```

### Example duplicate warehouse response

```json
{
  "message": "A warehouse with this code already exists"
}
```

### Example product delete conflict response

```json
{
  "message": "Active products must be deactivated before deletion"
}
```

### Create stock record

```json
{
  "productId": "PRODUCT_ID",
  "warehouseId": "WAREHOUSE_ID"
}
```
### Example success response

```json
{
  "message": "Stock record created successfully",
  "data": {
    "productId": "PRODUCT_ID",
    "warehouseId": "WAREHOUSE_ID",
    "quantity": 0,
    "status": "active"
  }
}
```

### Example duplicate stock response

```json
{
  "message": "Stock record already exists for this product and warehouse"
}
```

---

### Goods receipt

```json
{
  "stockId": "STOCK_ID",
  "quantity": 10,
  "reference": "PO-1002",
  "reason": "Supplier delivery"
}
```
---

## Goods Issue

```markdown
### Goods issue

```json
{
  "stockId": "STOCK_ID",
  "quantity": 3,
  "reference": "SO-1001",
  "reason": "Customer order"
}
```

---


## Project Structure

```text
inventory-management-api
│
├── src
│   ├── config
│   │   └── database.js
│   │
│   ├── controllers
│   │   ├── productController.js
│   │   ├── warehouseController.js
│   │   ├── stockController.js
│   │   ├── stockMovementController.js
│   │   ├── goodsReceiptController.js
│   │   └── goodsIssueController.js
│   │
│   ├── middleware
│   │
│   ├── models
│   │   ├── Product.js
│   │   ├── Warehouse.js
│   │   ├── Stock.js
│   │   └── StockMovement.js
│   │
│   ├── routes
│   │   ├── productRoutes.js
│   │   ├── warehouseRoutes.js
│   │   ├── stockRoutes.js
│   │   ├── stockMovementRoutes.js
│   │   ├── goodsReceiptRoutes.js
│   │   └── goodsIssueRoutes.js
│   │
│   ├── services
│   │
│   └── server.js
│
├── .env
├── .gitignore
├── package.json
└── README.md
```

---

## Architecture Overview

The project follows a simple layered backend structure.

```text
Routes
  ↓
Controllers
  ↓
Models
  ↓
Database
```

### Routes

Routes define the API endpoints and forward requests to the correct controller.

### Controllers

Controllers handle incoming requests, validate input, apply basic business rules and return HTTP responses.

### Models

Models define the MongoDB data structure using Mongoose schemas.

### Config

The config layer contains reusable configuration code, such as the MongoDB connection.

This structure keeps the project understandable and avoids unnecessary complexity.

---

## Environment Variables

Create a `.env` file in the project root:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/inventory_management
```

The `.env` file is ignored by Git and should not be committed.

---

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

The server should start on:

```text
http://localhost:3000
```

---

## Current Status

Implemented:

* Product management API
* Warehouse management API
* Stock management API
* MongoDB integration
* Environment-based configuration
* Business rules for product, warehouse and stock lifecycle
* Stock movement domain
* Goods receipt workflows
* Goods issue workflow

Current focus:

* Swagger / OpenAPI documentation
* MongoDB transactions
* Docker support

Planned later:

* Automated tests
* GitHub Actions CI


---

## Documentation

API documentation will be added later using Swagger/OpenAPI after the core business features are stable.

The documentation will describe:

* Available endpoints
* Request bodies
* Response formats
* Error responses
* Business rules

---

## Business Rules

Current product rules:

* Each product must have a unique SKU.
* Each product must have a name.
* Product unit is limited to predefined values.
* New products are active by default.
* Products can be updated partially.
* Products should be deactivated before deletion.
* Active products cannot be deleted.
* Only inactive products can be deleted.

Current warehouse rules:

* Each warehouse must have a unique code.
* Warehouse codes are stored in uppercase.
* Warehouse codes are treated as business identifiers and are not changed through the update endpoint.
* Warehouses can be deactivated.
* Warehouses are not deleted because they may later be linked to stock and stock movement history.

Current stock rules:

* A stock record connects one product with one warehouse.
* The combination of product and warehouse must be unique.
* A stock record can only be created for an active product.
* A stock record can only be created for an active warehouse.
* Stock quantity starts at `0`.
* Stock quantity is not changed directly through the stock API.
* Future quantity changes must be handled through stock movement workflows.
* Stock records are created only once for each product and warehouse combination and represent the current inventory state.

Current inventory rules:

* Stock quantity is never updated directly.
* Every inventory change is executed through a business process.
* Goods receipt creates a stock movement and increases the current stock quantity.
* Goods issue creates a stock movement and decreases the current stock quantity.
* Goods issue is rejected when available quantity is insufficient.

Supported product units:

```text
piece
kg
liter
meter
```

---

## Inventory Design Principles

Stock quantity will not be changed directly.

Future stock changes will be handled through business processes such as:

* Goods receipt
* Goods issue
* Stock movement history

The planned stock model will connect products and warehouses.
A stock record will represent the quantity of one product in one warehouse.

```text
                Product
                    │
                    ▼
              +-----------+
              |   Stock   |
              +-----------+
                    ▲
                    │
                Warehouse

                    │
                    ▼

          +------------------+
          | Stock Movement   |
          +------------------+
                    ▲
                    │
     ┌──────────────┴──────────────┐
     │                             │
Goods Receipt              Goods Issue
```

Stock movements will document why and how stock quantities changed.

---

## Roadmap

Completed:

1. Product management
2. Warehouse management
3. Stock management
4. Stock movement tracking
5. Goods receipt process
6. Goods issue process

Next milestones:

7. Swagger / OpenAPI documentation
8. MongoDB transactions
9. Docker support
10. Automated tests


---

## Why this project matters

Inventory and warehouse management are common real-world business problems.
Companies need systems that can manage products, warehouses, stock levels, goods receipts, goods issues and movement history.

This project demonstrates backend skills that are relevant for roles such as:

* Backend Developer
* API Developer
* Integration Developer
* Junior Software Developer

The project is focused on practical backend logic instead of frontend design.
It shows how backend APIs can model real business rules, not only simple CRUD operations.

---

## Design Philosophy

The project follows a business-first approach.

Instead of updating inventory quantities directly, every inventory change is executed through a business process and recorded as a stock movement.

This design keeps the current inventory state and its complete history separated while maintaining a clear and maintainable backend architecture.

---

## License

This project is currently developed for portfolio purposes.

