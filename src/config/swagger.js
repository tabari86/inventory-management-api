const swaggerJsdoc = require("swagger-jsdoc");

const productionServerUrl =
  process.env.SWAGGER_PRODUCTION_URL ||
  "https://inventory-management-api-6zuo.onrender.com";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Inventory Management API",
      version: "1.0.0",
      description:
        "API documentation for the Inventory Management backend, including product, warehouse, stock, inventory movement and authentication endpoints.",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development server",
      },
      {
        url: productionServerUrl,
        description: "Production server on Render",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["message"],
          properties: {
            message: {
              type: "string",
            },
          },
        },
        ValidationErrorResponse: {
          type: "object",
          required: ["message", "errors"],
          properties: {
            message: {
              type: "string",
              example: "Validation failed",
            },
            errors: {
              type: "array",
              items: {
                type: "object",
                required: ["field", "message"],
                properties: {
                  field: {
                    type: "string",
                  },
                  message: {
                    type: "string",
                  },
                },
              },
            },
          },
        },
        SuccessMessageResponse: {
          type: "object",
          required: ["message"],
          properties: {
            message: {
              type: "string",
            },
          },
        },
        Product: {
          type: "object",
          description:
            "Product aggregate. Archived products remain stored but are omitted from normal Product reads.",
          properties: {
            sku: { type: "string", maxLength: 64 },
            name: { type: "string", maxLength: 120 },
            description: { type: "string", maxLength: 500 },
            unit: { type: "string", enum: ["piece", "kg", "liter", "meter"] },
            status: { type: "string", enum: ["active", "inactive"] },
            version: { type: "integer", minimum: 1, readOnly: true },
            deactivatedAt: { type: "string", format: "date-time", readOnly: true },
            deactivatedBy: { type: "string", readOnly: true },
            deactivationReason: { type: "string", maxLength: 500, readOnly: true },
            archivedAt: { type: "string", format: "date-time", readOnly: true },
            archivedBy: { type: "string", readOnly: true },
            archiveReason: { type: "string", maxLength: 500, readOnly: true },
          },
        },
        Warehouse: {
          type: "object",
          properties: {
            code: { type: "string", maxLength: 64 },
            name: { type: "string", maxLength: 120 },
            description: { type: "string", maxLength: 500 },
            status: { type: "string", enum: ["active", "inactive"] },
            version: { type: "integer", minimum: 1, readOnly: true },
            deactivatedAt: { type: "string", format: "date-time", readOnly: true },
            deactivatedBy: { type: "string", readOnly: true },
            deactivationReason: { type: "string", maxLength: 500, readOnly: true },
          },
        },
        Stock: {
          type: "object",
          description:
            "Stock aggregate. Lifecycle guards are derived integrity fields and are not client-writable.",
          properties: {
            productId: { type: "string" },
            warehouseId: { type: "string" },
            quantity: { type: "number", minimum: 0 },
            status: { type: "string", enum: ["active", "inactive"] },
            version: { type: "integer", minimum: 1, readOnly: true },
            productLifecycleStatus: {
              type: "string",
              enum: ["active", "inactive", "archived"],
              readOnly: true,
            },
            warehouseLifecycleStatus: {
              type: "string",
              enum: ["active", "inactive"],
              readOnly: true,
            },
          },
        },
        StockMovement: {
          type: "object",
          description:
            "New movements include direct parent references, bounded snapshots, exact before/after quantities, and aggregateVersion. Legacy rows may omit additive integrity fields.",
          properties: {
            stockId: { type: "string" },
            productId: { type: "string" },
            warehouseId: { type: "string" },
            type: { type: "string", enum: ["GOODS_RECEIPT", "GOODS_ISSUE"] },
            quantity: { type: "number", minimum: 1 },
            reference: { type: "string" },
            reason: { type: "string" },
            quantityBefore: { type: "number", minimum: 0, readOnly: true },
            quantityAfter: { type: "number", minimum: 0, readOnly: true },
            aggregateVersion: { type: "integer", minimum: 1, readOnly: true },
            productSnapshot: {
              type: "object",
              readOnly: true,
              properties: {
                sku: { type: "string", maxLength: 64 },
                name: { type: "string", maxLength: 120 },
              },
            },
            warehouseSnapshot: {
              type: "object",
              readOnly: true,
              properties: {
                code: { type: "string", maxLength: 64 },
                name: { type: "string", maxLength: 120 },
              },
            },
          },
        },
        BulkProductsResponse: {
          type: "object",
          required: ["message", "data"],
          properties: {
            message: {
              type: "string",
            },
            data: {
              type: "object",
              properties: {
                createdCount: {
                  type: "integer",
                  minimum: 0,
                },
                updatedCount: {
                  type: "integer",
                  minimum: 0,
                },
                deletedCount: {
                  type: "integer",
                  minimum: 0,
                },
                products: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
        BulkWarehousesResponse: {
          type: "object",
          required: ["message", "data"],
          properties: {
            message: {
              type: "string",
            },
            data: {
              type: "object",
              properties: {
                createdCount: {
                  type: "integer",
                  minimum: 0,
                },
                updatedCount: {
                  type: "integer",
                  minimum: 0,
                },
                warehouses: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
        BulkStocksResponse: {
          type: "object",
          required: ["message", "data"],
          properties: {
            message: {
              type: "string",
            },
            data: {
              type: "object",
              required: ["createdCount", "stocks"],
              properties: {
                createdCount: {
                  type: "integer",
                  minimum: 0,
                },
                stocks: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
        BulkGoodsReceiptResponse: {
          type: "object",
          required: ["message", "data"],
          properties: {
            message: {
              type: "string",
            },
            data: {
              type: "object",
              required: ["processedCount", "stockMovements", "updatedStocks"],
              properties: {
                processedCount: {
                  type: "integer",
                  minimum: 0,
                },
                stockMovements: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
                updatedStocks: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
        BulkGoodsIssueResponse: {
          type: "object",
          required: ["message", "data"],
          properties: {
            message: {
              type: "string",
            },
            data: {
              type: "object",
              required: ["processedCount", "stockMovements", "updatedStocks"],
              properties: {
                processedCount: {
                  type: "integer",
                  minimum: 0,
                },
                stockMovements: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
                updatedStocks: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

module.exports = swaggerSpec;
