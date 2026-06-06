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
* Product management API
* Warehouse management API
* Required field validation
* Duplicate SKU and warehouse code validation
* Product deactivation and controlled deletion
* Warehouse deactivation without deletion
* Basic API error handling

Planned features:

* Stock model
* Stock movement history
* Goods receipt process
* Goods issue process
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

### Warehouses

| Method | Endpoint                         | Description                  |
| ------ | -------------------------------- | ---------------------------- |
| POST   | `/api/warehouses`                | Create a new warehouse       |
| GET    | `/api/warehouses`                | Retrieve all warehouses      |
| GET    | `/api/warehouses/:id`            | Retrieve a single warehouse  |
| PATCH  | `/api/warehouses/:id`            | Update warehouse information |
| PATCH  | `/api/warehouses/:id/deactivate` | Deactivate a warehouse       |

Warehouse deletion is intentionally not implemented because warehouses may later be connected to stock records and movement history.

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
│   │   └── warehouseController.js
│   │
│   ├── middleware
│   │
│   ├── models
│   │   ├── Product.js
│   │   └── Warehouse.js
│   │
│   ├── routes
│   │   ├── productRoutes.js
│   │   └── warehouseRoutes.js
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
* MongoDB integration
* Environment-based configuration
* Business rules for product and warehouse lifecycle

Current focus:

* Stock model
* Stock movements
* Goods receipt and goods issue workflows

Planned later:

* Swagger API documentation
* Docker setup
* Code quality improvements

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
 Stock
   ▲
   │
Warehouse
```

Stock movements will document why and how stock quantities changed.

---

## Roadmap

Planned development order:

1. Product management
2. Warehouse management
3. Stock model
4. Stock movement model
5. Goods receipt process
6. Goods issue process
7. Stock movement history
8. Swagger documentation
9. Docker setup

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

## License

This project is currently developed for portfolio purposes.

--- 

## Contact

Moj Tabari

Website: 
https://mtintelligence.ai

LinkedIn: 
https://www.linkedin.com/in/mojtaba-tabari

