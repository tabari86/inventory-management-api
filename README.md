# Inventory Management API

![Node.js](https://img.shields.io/badge/Node.js-Backend-green)
![Express](https://img.shields.io/badge/Express.js-API-lightgrey)
![MongoDB](https://img.shields.io/badge/MongoDB-Database-brightgreen)
![Status](https://img.shields.io/badge/Status-In%20Development-blue)

A backend API for managing products, warehouses and stock movements in a simple inventory management system.

This project is built as a realistic backend portfolio project.
The focus is not on creating a tutorial application, but on showing clean API design, business logic, database usage and a maintainable project structure.

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
* Product model with business-focused fields
* Create product endpoint
* Product listing endpoint
* Product detail endpoint
* Product update endpoint
* Product deactivation endpoint
* Product deletion with business rules
* Required field validation
* Duplicate SKU validation
* Basic API error handling

Planned features:

* Warehouse management
* Stock tracking
* Goods receipt process
* Goods issue process
* Stock movement history
* Swagger API documentation
* Docker setup

---

## API Endpoints

### Products

| Method | Endpoint                       | Description                |
| ------ | ------------------------------ | -------------------------- |
| POST   | `/api/products`                | Create a new product       |
| GET    | `/api/products`                | Retrieve all products      |
| GET    | `/api/products/:id`            | Retrieve a single product  |
| PATCH  | `/api/products/:id`            | Update product information |
| PATCH  | `/api/products/:id/deactivate` | Deactivate a product       |
| DELETE | `/api/products/:id`            | Delete an inactive product |

### Create Product

```http
POST /api/products
```

Creates a new product in the inventory system.

Required fields:

* `sku`
* `name`

Optional fields:

* `description`
* `unit`
* `status`

Possible responses:

```http
201 Created
400 Bad Request
409 Conflict
500 Internal Server Error
```

### Update Product

```http
PATCH /api/products/:id
```

Updates selected product fields.

Possible responses:

```http
200 OK
400 Bad Request
404 Not Found
409 Conflict
500 Internal Server Error
```

### Deactivate Product

```http
PATCH /api/products/:id/deactivate
```

Sets the product status to `inactive`.

### Delete Product

```http
DELETE /api/products/:id
```

Deletes a product only if it is already inactive.

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

Example success response:

```json
{
  "message": "Product created successfully",
  "data": {
    "sku": "LAPTOP-001",
    "name": "Dell Latitude 7450",
    "description": "Business laptop",
    "unit": "piece",
    "status": "active"
  }
}
```

Example duplicate SKU response:

```json
{
  "message": "A product with this SKU already exists"
}
```

### Update product

```json
{
  "description": "Updated business laptop description"
}
```

Example success response:

```json
{
  "message": "Product updated successfully"
}
```

### Deactivate product

```json
{
  "message": "Product deactivated successfully"
}
```

### Delete inactive product

```json
{
  "message": "Product deleted successfully"
}
```

Example delete conflict response:

```json
{
  "message": "Active products must be deactivated before deletion"
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
│   │   └── productController.js
│   │
│   ├── middleware
│   │
│   ├── models
│   │   └── Product.js
│   │
│   ├── routes
│   │   └── productRoutes.js
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
* Product creation
* Product listing
* Product detail endpoint
* Product update endpoint
* Product deactivation
* Product deletion with business rules
* MongoDB integration
* Environment-based configuration

Next planned step:

* Warehouse management

Planned later:

* Stock tracking
* Goods receipt process
* Goods issue process
* Stock movement history
* Swagger API documentation
* Docker setup

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

Supported product units:

```text
piece
kg
liter
meter
```

---

## Roadmap

Planned development order:

1. Product management
2. Warehouse model
3. Warehouse API endpoints
4. Stock model
5. Goods receipt process
6. Goods issue process
7. Stock movement history
8. Swagger documentation
9. Docker setup

---

## Why this project matters

Inventory and warehouse management are common real-world business problems.
Companies need systems that can manage products, stock levels, goods receipts, goods issues and stock movement history.

This project demonstrates backend skills that are relevant for roles such as:

* Backend Developer
* API Developer
* Integration Developer
* Junior Software Developer

The project is focused on practical backend logic instead of frontend design.
It shows how product data can be managed with validation, clear API endpoints and basic business rules.

---

## License

This project is currently developed for portfolio purposes.
