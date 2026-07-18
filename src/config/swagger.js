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
