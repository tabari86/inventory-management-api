const swaggerJsdoc = require("swagger-jsdoc");
const {
  mutationOperationRegistry,
} = require("../services/inventoryOperationRegistry");

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
        LivenessResponse: {
          type: "object",
          required: ["status", "service"],
          properties: {
            status: { type: "string", enum: ["ok"] },
            service: {
              type: "string",
              enum: ["inventory-management-api"],
            },
          },
        },
        ReadinessResponse: {
          type: "object",
          required: ["status", "service"],
          properties: {
            status: { type: "string", enum: ["ready", "unavailable"] },
            service: {
              type: "string",
              enum: ["inventory-management-api"],
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

swaggerSpec.components.parameters = {
  ...(swaggerSpec.components.parameters || {}),
  RequestId: {
    name: "X-Request-ID",
    in: "header",
    required: false,
    description:
      "Provides a caller request identifier when it is a valid 1-128 character context value. Invalid or missing values are replaced with a server-generated UUID.",
    schema: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    },
  },
  CorrelationId: {
    name: "X-Correlation-ID",
    in: "header",
    required: false,
    description:
      "Identifies a caller-provided operation chain. A valid value is echoed in responses; an invalid or missing value defaults to the effective request ID. It does not define idempotency identity, and changing it does not prevent same-payload replay.",
    schema: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    },
  },
  IdempotencyKey: {
    name: "Idempotency-Key",
    in: "header",
    required: false,
    description:
      "Optional opaque, case-sensitive key (8-128 characters; A-Z, a-z, 0-9, dot, underscore, colon, and hyphen). It is scoped to the current authenticated actor and stable business operation. The raw key is never stored; its SHA-256 digest is retained for seven days. Reusing the key with the same normalized command replays the exact successful status/body, while a different command conflicts.",
    schema: {
      type: "string",
      minLength: 8,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    },
  },
};

swaggerSpec.components.headers = {
  ...(swaggerSpec.components.headers || {}),
  XRequestId: {
    description:
      "Accepted valid caller request ID, or a server-generated UUID when missing or invalid.",
    schema: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    },
  },
  XCorrelationId: {
    description:
      "Accepted valid client correlation ID, or the effective request ID when missing or invalid.",
    schema: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    },
  },
  IdempotencyReplayed: {
    description:
      "false for an original successful keyed execution, true for a replay, and absent when no idempotency key is supplied.",
    schema: { type: "string", enum: ["true", "false"] },
  },
};

const requestContextResponseHeaders = {
  "X-Request-ID": { $ref: "#/components/headers/XRequestId" },
  "X-Correlation-ID": { $ref: "#/components/headers/XCorrelationId" },
};

const httpMethods = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
]);

const hasHeaderParameter = (operation, name, reference) =>
  (operation.parameters || []).some(
    (parameter) =>
      parameter.$ref === reference ||
      (parameter.in === "header" && parameter.name === name)
  );

const mergeErrorCodes = (response, extension, errorCodes) => {
  const existing = response[extension];
  const existingCodes = Array.isArray(existing)
    ? existing
    : existing === undefined
      ? []
      : [existing];

  response[extension] = [...new Set([...existingCodes, ...errorCodes])];
};

for (const pathItem of Object.values(swaggerSpec.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!httpMethods.has(method) || !operation.responses) continue;
    const requestIdReference = "#/components/parameters/RequestId";
    const correlationReference = "#/components/parameters/CorrelationId";
    if (!hasHeaderParameter(operation, "X-Request-ID", requestIdReference)) {
      operation.parameters = [
        ...(operation.parameters || []),
        { $ref: requestIdReference },
      ];
    }
    if (
      !hasHeaderParameter(operation, "X-Correlation-ID", correlationReference)
    ) {
      operation.parameters = [
        ...(operation.parameters || []),
        { $ref: correlationReference },
      ];
    }

    for (const response of Object.values(operation.responses)) {
      response.headers = {
        ...(response.headers || {}),
        ...requestContextResponseHeaders,
      };
    }
  }
}

for (const { method, path, operationId } of mutationOperationRegistry) {
  const operation = swaggerSpec.paths[path]?.[method];
  if (!operation) continue;

  operation.operationId = operationId;
  const idempotencyReference = "#/components/parameters/IdempotencyKey";
  if (
    !hasHeaderParameter(operation, "Idempotency-Key", idempotencyReference)
  ) {
    operation.parameters = [
      ...(operation.parameters || []),
      { $ref: idempotencyReference },
    ];
  }
  operation.description = `${operation.description || ""} Optional idempotency is evaluated after current authentication, authorization, and normalized validation. Successful 2xx responses are stored atomically for exact replay for seven days; conflicting payloads or an unresolved concurrent request return 409. Invalid idempotency headers return 400; invalid request or correlation IDs are replaced with safe effective values.`.trim();
  operation["x-idempotency-errors"] = {
    invalidHeaders: "400",
    conflictingPayload: "409",
    unresolvedInProgress: "409",
  };

  operation.responses["400"] ||= { description: "Validation failed" };
  operation.responses["409"] ||= {
    description: "Idempotency conflict or unresolved in-progress request",
  };
  mergeErrorCodes(operation.responses["400"], "x-idempotency-errors", [
    "INVALID_IDEMPOTENCY_KEY",
  ]);
  mergeErrorCodes(operation.responses["409"], "x-idempotency-errors", [
    "IDEMPOTENCY_CONFLICT",
    "IDEMPOTENCY_IN_PROGRESS",
  ]);

  for (const response of Object.values(operation.responses)) {
    response.headers = {
      ...(response.headers || {}),
      ...requestContextResponseHeaders,
      "Idempotency-Replayed": {
        $ref: "#/components/headers/IdempotencyReplayed",
      },
    };
  }
}

module.exports = swaggerSpec;
