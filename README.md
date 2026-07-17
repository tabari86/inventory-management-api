# Inventory Management API

![Node.js](https://img.shields.io/badge/Node.js-Backend-green)
![Express](https://img.shields.io/badge/Express.js-API-lightgrey)
![MongoDB](https://img.shields.io/badge/MongoDB-Database-brightgreen)
![JWT](https://img.shields.io/badge/Auth-JWT-orange)
![RBAC](https://img.shields.io/badge/Authorization-RBAC-purple)
![Swagger](https://img.shields.io/badge/API%20Docs-Swagger-brightgreen)
![Docker](https://img.shields.io/badge/Container-Docker-blue)
![Tests](https://img.shields.io/badge/Tests-Jest%20%2B%20Supertest-green)
![CI](https://img.shields.io/badge/CI-GitHub%20Actions-blue)
![Deployment](https://img.shields.io/badge/Deployment-Render-purple)
![Status](https://img.shields.io/badge/Status-Production--Oriented-success)

Inventory Management API is a Node.js and Express backend for managing products, warehouses, stock records and inventory workflows.

The project focuses on realistic backend concerns such as authentication, role-based access control, controlled user provisioning, bulk inventory operations and stock movement history. It is built as a backend portfolio project and not as a full warehouse management system.

---

## Project Goal

The goal of this project is to model a practical inventory backend with real business rules instead of only simple CRUD endpoints.

The API covers:

- product and warehouse management
- stock records for product/warehouse combinations
- goods receipt and goods issue workflows
- stock movement history
- role-based access control
- controlled user creation
- bulk operations for import and automation scenarios

The project is suitable for integration-focused use cases such as internal admin tools, warehouse workflows, automation processes or n8n-based inventory scenarios.

---

## Live Demo

The API is deployed on Render and connected to MongoDB Atlas.

```text
https://inventory-management-api-6zuo.onrender.com
```

Swagger UI is available at:

```text
https://inventory-management-api-6zuo.onrender.com/api-docs
```

Health check:

```text
https://inventory-management-api-6zuo.onrender.com/health
```

Note: The service runs on Render's free plan, so the first request after inactivity may take a few seconds.

---

## Tech Stack

- Node.js
- Express.js
- MongoDB
- Mongoose
- dotenv
- bcrypt
- jsonwebtoken
- express-validator
- swagger-jsdoc
- swagger-ui-express
- Docker
- Docker Compose
- Jest
- Supertest
- mongodb-memory-server
- GitHub Actions
- Render
- MongoDB Atlas

---

## Features

### Authentication and User Management

- JWT-based login
- Refresh token workflow
- Refresh token hashing and rotation
- Logout with refresh token revocation
- Current user endpoint
- No public user registration
- Initial admin creation through seed script
- Admin-only user creation
- Admins can create `manager` and `viewer` users
- Creating another admin through the API is not allowed

### Role-Based Access Control

The API uses three roles:

| Role      | Description                                               |
|-----------|-----------------------------------------------------------|
| `admin`   | Full access, including user creation and product deletion |
| `manager` | Can manage inventory data and inventory workflows         |
| `viewer`  | Read-only access to inventory data                        |

### Inventory Management

- Product management
- Warehouse management
- Stock records for product/warehouse combinations
- Goods receipt workflow for increasing stock
- Goods issue workflow for decreasing stock
- Read-only stock movement history
- Bulk operations for products, warehouses, stocks and inventory workflows

### Bulk Operations

Bulk endpoints are included for practical import and automation scenarios.

Supported bulk operations:

- bulk product creation
- bulk product update
- bulk product deletion
- bulk warehouse creation
- bulk warehouse update
- bulk stock setup
- bulk goods receipt
- bulk goods issue

Bulk requests are limited to a maximum of 150 items per request.

---

## API Endpoints

### Authentication

| Method | Endpoint            | Description                                         |
|--------|---------------------|-----------------------------------------------------|
| `POST` | `/api/auth/login`   | Login and receive access/refresh tokens             |
| `POST` | `/api/auth/refresh` | Rotate refresh token and receive a new access token |
| `POST` | `/api/auth/logout`  | Revoke refresh token                                |
| `GET`  | `/api/auth/me`      | Get the current authenticated user                  |

### Users

| Method | Endpoint     | Role  | Description                     |
|--------|--------------|-------|---------------------------------|
| `POST` | `/api/users` | admin | Create a manager or viewer user |

Public registration is intentionally not available. The first admin user is created through the seed script.

### Products

| Method   | Endpoint                       | Role                   | Description                       |
|----------|--------------------------------|------------------------|-----------------------------------|
| `GET`    | `/api/products`                | admin, manager, viewer | Retrieve all products             |
| `GET`    | `/api/products/:id`            | admin, manager, viewer | Retrieve a single product         |
| `POST`   | `/api/products`                | admin, manager         | Create a new product              |
| `PATCH`  | `/api/products/:id`            | admin, manager         | Update product information        |
| `PATCH`  | `/api/products/:id/deactivate` | admin, manager         | Deactivate a product              |
| `DELETE` | `/api/products/:id`            | admin                  | Delete an inactive product        |
| `POST`   | `/api/products/bulk`           | admin, manager         | Create multiple products          |
| `PATCH`  | `/api/products/bulk`           | admin, manager         | Update multiple products          |
| `DELETE` | `/api/products/bulk`           | admin                  | Delete multiple inactive products |

### Warehouses

| Method  | Endpoint                         | Role                   | Description                  |
|---------|----------------------------------|------------------------|------------------------------|
| `GET`   | `/api/warehouses`                | admin, manager, viewer | Retrieve all warehouses      |
| `GET`   | `/api/warehouses/:id`            | admin, manager, viewer | Retrieve a single warehouse  |
| `POST`  | `/api/warehouses`                | admin, manager         | Create a new warehouse       |
| `PATCH` | `/api/warehouses/:id`            | admin, manager         | Update warehouse information |
| `PATCH` | `/api/warehouses/:id/deactivate` | admin, manager         | Deactivate a warehouse       |
| `POST`  | `/api/warehouses/bulk`           | admin, manager         | Create multiple warehouses   |
| `PATCH` | `/api/warehouses/bulk`           | admin, manager         | Update multiple warehouses   |

Warehouse deletion is intentionally not implemented because warehouses can be connected to stock records and movement history.

### Stocks

| Method | Endpoint           | Role                   | Description                                       |
|--------|--------------------|------------------------|---------------------------------------------------|
| `GET`  | `/api/stocks`      | admin, manager, viewer | Retrieve all stock records                        |
| `GET`  | `/api/stocks/:id`  | admin, manager, viewer | Retrieve a single stock record                    |
| `POST` | `/api/stocks`      | admin, manager         | Create a stock record for a product and warehouse |
| `POST` | `/api/stocks/bulk` | admin, manager         | Create multiple stock records                     |

Stock quantity is not updated directly through the stock API. Quantity changes are handled through goods receipt and goods issue workflows.

### Goods Receipts

| Method | Endpoint                   | Role           | Description                               |
|--------|----------------------------|----------------|-------------------------------------------|
| `POST` | `/api/goods-receipts`      | admin, manager | Receive goods and increase stock quantity |
| `POST` | `/api/goods-receipts/bulk` | admin, manager | Process multiple goods receipts           |

### Goods Issues

| Method | Endpoint | Role | Description |
|--------|--------------------------|----------------|-----------------------------------------|
| `POST` | `/api/goods-issues`      | admin, manager | Issue goods and decrease stock quantity |
| `POST` | `/api/goods-issues/bulk` | admin, manager | Process multiple goods issues           |

### Stock Movements

| Method | Endpoint                   | Role                   | Description                      |
|--------|----------------------------|------------------------|----------------------------------|
| `GET`  | `/api/stock-movements`     | admin, manager, viewer | Retrieve stock movement history  |
| `GET`  | `/api/stock-movements/:id` | admin, manager, viewer | Retrieve a single stock movement |

Stock movements are generated by inventory workflows and exposed as read-only history. Manual stock movement creation is intentionally not exposed.

---

## Example Requests

### Seed Initial Admin

Before users can log in, create the first admin user:

```bash
npm run seed:admin
```

The command uses these environment variables:

```env
ADMIN_NAME=Initial Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change_this_admin_password
```

The seed command is safe to run again. If an admin already exists, no new admin will be created.

### Login

```json
{
  "email": "admin@example.com",
  "password": "change_this_admin_password"
}
```

### Create Manager User

```json
{
  "name": "Warehouse Manager",
  "email": "manager@example.com",
  "password": "Password123!",
  "role": "manager"
}
```

### Create Product

```json
{
  "sku": "LAPTOP-001",
  "name": "Dell Latitude 7450",
  "description": "Business laptop",
  "unit": "piece"
}
```

### Bulk Create Products

```json
[
  {
    "sku": "PROD-001",
    "name": "Product One",
    "unit": "piece"
  },
  {
    "sku": "PROD-002",
    "name": "Product Two",
    "unit": "piece"
  }
]
```

### Create Warehouse

```json
{
  "code": "WH-STU",
  "name": "Main Warehouse",
  "description": "Primary warehouse for incoming and outgoing goods"
}
```

### Bulk Create Warehouses

```json
[
  {
    "code": "WH-001",
    "name": "Main Warehouse"
  },
  {
    "code": "WH-002",
    "name": "Secondary Warehouse"
  }
]
```

### Create Stock Record

```json
{
  "productId": "PRODUCT_ID",
  "warehouseId": "WAREHOUSE_ID"
}
```

### Bulk Create Stock Records

```json
[
  {
    "productId": "PRODUCT_ID",
    "warehouseId": "WAREHOUSE_ID"
  },
  {
    "productId": "ANOTHER_PRODUCT_ID",
    "warehouseId": "WAREHOUSE_ID"
  }
]
```

### Goods Receipt

```json
{
  "stockId": "STOCK_ID",
  "quantity": 10,
  "reference": "PO-1001",
  "reason": "Supplier delivery"
}
```

### Bulk Goods Receipt

```json
[
  {
    "stockId": "STOCK_ID",
    "quantity": 10,
    "reference": "PO-1001",
    "reason": "Supplier delivery"
  },
  {
    "stockId": "STOCK_ID",
    "quantity": 5,
    "reference": "PO-1002",
    "reason": "Second delivery"
  }
]
```

### Goods Issue

```json
{
  "stockId": "STOCK_ID",
  "quantity": 3,
  "reference": "SO-1001",
  "reason": "Customer order"
}
```

### Bulk Goods Issue

```json
[
  {
    "stockId": "STOCK_ID",
    "quantity": 3,
    "reference": "SO-1001",
    "reason": "Customer order"
  },
  {
    "stockId": "STOCK_ID",
    "quantity": 2,
    "reference": "SO-1002",
    "reason": "Second order"
  }
]
```

### Refresh Access Token

```json
{
  "refreshToken": "REFRESH_TOKEN"
}
```

### Logout

```json
{
  "refreshToken": "REFRESH_TOKEN"
}
```

---

## Business Rules

### User and Authentication Rules

- Public registration is not available.
- The first admin user is created through `npm run seed:admin`.
- The seed script does not create another admin if an admin already exists.
- Admin users can create `manager` and `viewer` users.
- API users cannot create another admin through `/api/users`.
- Passwords are hashed before being stored.
- Refresh tokens are stored as hashes in the database.
- Refresh tokens are rotated when refreshing access tokens.
- Logout revokes the current refresh token.

### Product Rules

- Each product must have a unique SKU.
- Each product must have a name.
- Product unit is limited to predefined values.
- New products are active by default.
- Products can be updated partially.
- Products must be deactivated before deletion.
- Active products cannot be deleted.

Supported product units:

```text
piece
kg
liter
meter
```

### Warehouse Rules

- Each warehouse must have a unique code.
- Warehouse codes are stored in uppercase.
- Warehouse codes are treated as business identifiers.
- Warehouse codes cannot be changed through update endpoints.
- Warehouses can be deactivated.
- Warehouses are not deleted.

### Stock Rules

- A stock record connects one product with one warehouse.
- The combination of product and warehouse must be unique.
- A stock record can only be created for an active product.
- A stock record can only be created for an active warehouse.
- Stock quantity starts at `0`.
- Stock quantity is not changed directly through the stock API.

### Inventory Workflow Rules

- Stock quantity changes are handled through goods receipt and goods issue workflows.
- Goods receipt creates a stock movement and increases current stock quantity.
- Goods issue creates a stock movement and decreases current stock quantity.
- Goods issue is rejected when available quantity is insufficient.
- Stock movements are read-only history.
- Manual stock movement creation is intentionally not exposed.

---

## Inventory Design Principles

Stock quantity is not changed directly.

Inventory changes are handled through business workflows:

- Goods receipt
- Goods issue
- Stock movement history

The stock model connects products and warehouses. A stock record represents the quantity of one product in one warehouse.

```text
Product
   |
   v
+-------+
| Stock |
+-------+
   ^
   |
Warehouse

Stock changes are handled by:

Goods Receipt  -> increases stock -> creates stock movement
Goods Issue    -> decreases stock -> creates stock movement
```

This keeps the current inventory state and its movement history separated.

---

## Architecture Overview

The project follows a simple layered backend structure.

```text
Client
   |
   v
Routes
   |
   v
Validation
   |
   v
Controllers
   |
   v
Models
   |
   v
MongoDB

Errors
   |
   v
Global Error Handler
```

Authentication is handled through JWT access tokens and refresh tokens.

Access tokens are used to protect private routes. Refresh tokens are stored as hashes in the database and can be revoked during logout or token rotation.

For automated testing, the Express application is separated from the server startup logic. `src/app.js` exports the Express app for tests, while `src/server.js` connects to the database and starts the HTTP server.

### Routes

Routes define the API endpoints and forward requests to the correct controller.

### Validation

Validation rules check request payloads before controller logic is executed.

### Controllers

Controllers handle incoming requests, apply business rules and return HTTP responses.

### Models

Models define the MongoDB data structure using Mongoose schemas.

### Config

The config layer contains reusable configuration code, such as MongoDB and Swagger setup.

This structure keeps the project understandable and avoids unnecessary complexity.

---

## Environment Variables

Use `.env.example` as a template for local configuration:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Example values:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/inventory_management
JWT_ACCESS_SECRET=change_this_access_token_secret
JWT_ACCESS_EXPIRES_IN=15m

ADMIN_NAME=Initial Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change_this_admin_password
```

The `.env` file is ignored by Git and should not be committed.

For production deployments, use strong secret values and do not commit real credentials.

---

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Create the initial admin user:

```bash
npm run seed:admin
```

Start the development server:

```bash
npm run dev
```

The server should start on:

```text
http://localhost:3000
```

Run the automated test suite:

```bash
npm test
```

---

## Run with Docker

Build and start the API together with MongoDB:

```bash
docker compose up --build
```

The API will be available at:

```text
http://localhost:3000
```

Health check endpoint:

```text
http://localhost:3000/health
```

Swagger documentation:

```text
http://localhost:3000/api-docs
```

Stop the containers:

```bash
docker compose down
```

If the admin user has not been created yet, run the seed command with the correct environment variables:

```bash
npm run seed:admin
```

The seed step is not intended to run automatically on every application startup.

---

## Testing

The project includes automated API tests with Jest, Supertest and mongodb-memory-server.

The tests cover:

- root API endpoint
- authentication workflows
- refresh token rotation
- logout token revocation
- admin-only user creation
- role-based access control
- product API
- warehouse API
- stock API
- stock movement read routes
- goods receipt workflow
- goods issue workflow
- bulk operations
- request validation
- rejection of public registration
- disabled manual stock movement creation

Run tests:

```bash
npm test
```

---

## Documentation

Interactive API documentation is available through Swagger UI.

Local Swagger UI:

```text
http://localhost:3000/api-docs
```

Production Swagger UI:

```text
https://inventory-management-api-6zuo.onrender.com/api-docs
```

### Swagger UI Preview

![Swagger UI Preview](docs/Swagger-UI.png)

---

## Project Structure

```text
inventory-management-api/
|
|-- .github/
|   `-- workflows/
|       `-- ci.yml
|
|-- scripts/
|   `-- seedAdmin.js
|
|-- src/
|   |-- app.js
|   |-- server.js
|   |
|   |-- config/
|   |   |-- database.js
|   |   `-- swagger.js
|   |
|   |-- controllers/
|   |   |-- authController.js
|   |   |-- userController.js
|   |   |-- productController.js
|   |   |-- warehouseController.js
|   |   |-- stockController.js
|   |   |-- stockMovementController.js
|   |   |-- goodsReceiptController.js
|   |   `-- goodsIssueController.js
|   |
|   |-- middleware/
|   |   |-- authMiddleware.js
|   |   |-- roleMiddleware.js
|   |   |-- validateRequest.js
|   |   `-- errorHandler.js
|   |
|   |-- models/
|   |   |-- User.js
|   |   |-- RefreshToken.js
|   |   |-- Product.js
|   |   |-- Warehouse.js
|   |   |-- Stock.js
|   |   `-- StockMovement.js
|   |
|   |-- routes/
|   |   |-- authRoutes.js
|   |   |-- userRoutes.js
|   |   |-- productRoutes.js
|   |   |-- warehouseRoutes.js
|   |   |-- stockRoutes.js
|   |   |-- stockMovementRoutes.js
|   |   |-- goodsReceiptRoutes.js
|   |   `-- goodsIssueRoutes.js
|   |
|   `-- validators/
|       |-- userValidator.js
|       |-- productValidator.js
|       |-- warehouseValidator.js
|       |-- stockValidator.js
|       |-- goodsReceiptValidator.js
|       `-- goodsIssueValidator.js
|
|-- tests/
|   |-- helpers/
|   |   `-- authTestHelper.js
|   |
|   |-- app.test.js
|   |-- auth.test.js
|   |-- user.test.js
|   |-- product.test.js
|   |-- warehouse.test.js
|   |-- stock.test.js
|   |-- stockMovement.test.js
|   |-- inventoryWorkflow.test.js
|   `-- setupTestDb.js
|
|-- docs/
|   `-- Swagger-UI.png
|
|-- .env.example
|-- .dockerignore
|-- .gitignore
|-- Dockerfile
|-- docker-compose.yml
|-- package.json
|-- package-lock.json
`-- README.md
```

---

## Current Status

Implemented:

- product management API
- warehouse management API
- stock management API
- controlled admin seeding
- admin-only user creation
- JWT authentication
- refresh token rotation
- refresh token revocation
- role-based access control
- protected inventory endpoints
- product bulk operations
- warehouse bulk operations
- stock bulk setup
- goods receipt workflow
- goods issue workflow
- read-only stock movement history
- request validation with express-validator
- global error handling
- Swagger / OpenAPI documentation
- Docker support
- Docker Compose setup with MongoDB
- automated API tests
- GitHub Actions CI workflow
- deployment on Render
- MongoDB Atlas production database connection

Current focus:

- production hardening
- documentation consistency
- operational improvements

---

## Roadmap

Possible future improvements:

- request-level audit metadata
- pagination and filtering for larger datasets
- improved operational logging
- more detailed Swagger schemas for bulk endpoints
- transaction support for inventory workflows when MongoDB replica set infrastructure is available

---

## Why this project matters

Inventory and warehouse management are common real-world business problems. Companies need systems that can manage products, warehouses, stock levels, goods receipts, goods issues and movement history.

This project demonstrates backend skills that are relevant for roles such as:

- Backend Developer
- API Developer
- Integration Developer
- Software Developer

The project is focused on backend logic and API design. It shows how backend APIs can model real business rules instead of only simple CRUD operations.

---

## Design Notes

The project follows a business-first approach.

Instead of updating inventory quantities directly, stock changes are handled through goods receipt and goods issue workflows. Each workflow updates the current stock quantity and creates stock movement history.

Some design choices are intentional:

- no public registration
- no automatic admin creation on application startup
- no direct stock quantity updates
- no manual stock movement creation
- stock movement history is generated by inventory workflows
- MongoDB transactions are not part of this version
- Swagger is public for portfolio/demo visibility, while protected endpoints still require authentication

---

## License

ISC

---

## Project Note

This project is built as a backend portfolio project to demonstrate API design, authentication, RBAC, inventory workflows and integration-ready bulk operations.