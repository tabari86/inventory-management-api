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
              additionalProperties: false,
              required: ["sku", "name"],
              properties: {
                sku: { type: "string", maxLength: 64 },
                name: { type: "string", maxLength: 120 },
              },
            },
            warehouseSnapshot: {
              type: "object",
              readOnly: true,
              additionalProperties: false,
              required: ["code", "name"],
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

swaggerSpec.info.description =
  "Canonical Inventory Management API contract under /api/v1. The temporary /api compatibility prefix remains reachable at runtime but is intentionally omitted from canonical paths. Legacy collection reads are bounded and expose continuation through X-Next-Cursor; new integrations should use /api/v1.";
swaggerSpec["x-canonical-prefix"] = "/api/v1";
swaggerSpec["x-legacy-compatibility-prefix"] = "/api";
swaggerSpec["x-legacy-collection-contract"] =
  "Legacy lists retain {message,data}, are bounded, and use X-Next-Cursor.";

swaggerSpec.paths = Object.fromEntries(
  Object.entries(swaggerSpec.paths).map(([path, pathItem]) => [
    path.startsWith("/api/") && path !== "/api/ready"
      ? path.replace(/^\/api\//, "/api/v1/")
      : path,
    pathItem,
  ])
);

const objectSchema = (required, properties) => ({
  type: "object",
  additionalProperties: false,
  ...(required.length > 0 ? { required } : {}),
  properties,
});
const nullableDateTime = {
  type: "string",
  format: "date-time",
  nullable: true,
};
const objectId = { type: "string", pattern: "^[a-fA-F0-9]{24}$" };
const resourceTimestamps = {
  _id: objectId,
  createdAt: { type: "string", format: "date-time", readOnly: true },
  updatedAt: { type: "string", format: "date-time", readOnly: true },
};

Object.assign(swaggerSpec.components.schemas, {
  RootResponse: objectSchema(["message"], {
    message: {
      type: "string",
      enum: ["Inventory Management API is running"],
    },
  }),
  V1Meta: objectSchema(
    ["requestId", "correlationId", "schemaVersion"],
    {
      requestId: { type: "string" },
      correlationId: { type: "string" },
      schemaVersion: { type: "string", enum: ["1.0"] },
    }
  ),
  V1PaginationMeta: objectSchema(
    ["requestId", "correlationId", "schemaVersion", "limit", "nextCursor"],
    {
      requestId: { type: "string" },
      correlationId: { type: "string" },
      schemaVersion: { type: "string", enum: ["1.0"] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      nextCursor: { type: "string", nullable: true, maxLength: 1024 },
    }
  ),
  V1FieldError: objectSchema(["field", "message"], {
    field: { type: "string", maxLength: 128 },
    message: { type: "string", maxLength: 512 },
  }),
  V1Error: objectSchema(
    [
      "type",
      "title",
      "status",
      "code",
      "detail",
      "requestId",
      "correlationId",
      "retryable",
      "errors",
    ],
    {
      type: { type: "string", enum: ["inventory-error"] },
      title: { type: "string" },
      status: { type: "integer", minimum: 400, maximum: 599 },
      code: { type: "string", pattern: "^[A-Z][A-Z0-9_]*$" },
      detail: { type: "string" },
      requestId: { type: "string" },
      correlationId: { type: "string" },
      retryable: { type: "boolean" },
      errors: {
        type: "array",
        maxItems: 50,
        items: { $ref: "#/components/schemas/V1FieldError" },
      },
    }
  ),
  UserPublic: objectSchema(["name", "email", "role", "status"], {
    id: objectId,
    name: { type: "string" },
    email: { type: "string", format: "email" },
    role: { type: "string", enum: ["admin", "manager", "viewer"] },
    status: { type: "string", enum: ["active", "inactive"] },
  }),
  ProductSummary: objectSchema(["_id", "sku", "name", "unit", "status"], {
    _id: objectId,
    sku: { type: "string", maxLength: 64 },
    name: { type: "string", maxLength: 120 },
    unit: { type: "string", enum: ["piece", "kg", "liter", "meter"] },
    status: { type: "string", enum: ["active", "inactive"] },
    archivedAt: nullableDateTime,
  }),
  WarehouseSummary: objectSchema(["_id", "code", "name", "status"], {
    _id: objectId,
    code: { type: "string", maxLength: 64 },
    name: { type: "string", maxLength: 120 },
    status: { type: "string", enum: ["active", "inactive"] },
  }),
  AuthLoginData: objectSchema(["accessToken", "refreshToken", "user"], {
    accessToken: { type: "string" },
    refreshToken: { type: "string" },
    user: { $ref: "#/components/schemas/UserPublic" },
  }),
  AuthRefreshData: objectSchema(["accessToken", "refreshToken"], {
    accessToken: { type: "string" },
    refreshToken: { type: "string" },
  }),
  NullData: {
    type: "object",
    nullable: true,
    additionalProperties: false,
    maxProperties: 0,
  },
});

for (const resourceName of ["Product", "Warehouse", "Stock", "StockMovement"]) {
  const schema = swaggerSpec.components.schemas[resourceName];
  schema.additionalProperties = false;
  schema.properties = { ...resourceTimestamps, ...schema.properties };
}
swaggerSpec.components.schemas.Product.required = [
  "_id",
  "sku",
  "name",
  "unit",
  "status",
  "version",
  "createdAt",
  "updatedAt",
];
swaggerSpec.components.schemas.Product.properties.archivedAt = nullableDateTime;
swaggerSpec.components.schemas.Warehouse.required = [
  "_id",
  "code",
  "name",
  "status",
  "version",
  "createdAt",
  "updatedAt",
];
swaggerSpec.components.schemas.Stock.required = [
  "_id",
  "productId",
  "warehouseId",
  "quantity",
  "status",
  "version",
  "createdAt",
  "updatedAt",
];
swaggerSpec.components.schemas.Stock.properties.productId = {
  oneOf: [objectId, { $ref: "#/components/schemas/ProductSummary" }],
};
swaggerSpec.components.schemas.Stock.properties.warehouseId = {
  oneOf: [objectId, { $ref: "#/components/schemas/WarehouseSummary" }],
};
swaggerSpec.components.schemas.StockMovement.required = [
  "_id",
  "stockId",
  "type",
  "quantity",
  "createdAt",
  "updatedAt",
];
swaggerSpec.components.schemas.StockMovement.properties.productId = {
  oneOf: [objectId, { $ref: "#/components/schemas/ProductSummary" }],
};
swaggerSpec.components.schemas.StockMovement.properties.warehouseId = {
  oneOf: [objectId, { $ref: "#/components/schemas/WarehouseSummary" }],
};
swaggerSpec.components.schemas.StockMovement.properties.stockId = {
  oneOf: [objectId, { $ref: "#/components/schemas/Stock" }],
};

Object.assign(swaggerSpec.components.schemas, {
  BulkProductsData: objectSchema([], {
    createdCount: { type: "integer", minimum: 0 },
    updatedCount: { type: "integer", minimum: 0 },
    deletedCount: { type: "integer", minimum: 0 },
    products: {
      type: "array",
      items: { $ref: "#/components/schemas/Product" },
    },
  }),
  BulkWarehousesData: objectSchema([], {
    createdCount: { type: "integer", minimum: 0 },
    updatedCount: { type: "integer", minimum: 0 },
    warehouses: {
      type: "array",
      items: { $ref: "#/components/schemas/Warehouse" },
    },
  }),
  BulkStocksData: objectSchema(["createdCount", "stocks"], {
    createdCount: { type: "integer", minimum: 0 },
    stocks: { type: "array", items: { $ref: "#/components/schemas/Stock" } },
  }),
  InventoryMutationData: objectSchema(["stock", "stockMovement"], {
    stock: { $ref: "#/components/schemas/Stock" },
    stockMovement: { $ref: "#/components/schemas/StockMovement" },
  }),
  BulkInventoryMutationData: objectSchema(
    ["processedCount", "stockMovements", "updatedStocks"],
    {
      processedCount: { type: "integer", minimum: 0 },
      stockMovements: {
        type: "array",
        items: { $ref: "#/components/schemas/StockMovement" },
      },
      updatedStocks: {
        type: "array",
        items: { $ref: "#/components/schemas/Stock" },
      },
    }
  ),
});

const envelopeSchema = (data, paginated = false) =>
  objectSchema(["data", "meta"], {
    data,
    meta: {
      $ref: paginated
        ? "#/components/schemas/V1PaginationMeta"
        : "#/components/schemas/V1Meta",
    },
  });

const successSchemas = {
  V1NullResponse: envelopeSchema({ $ref: "#/components/schemas/NullData" }),
  V1UserResponse: envelopeSchema({ $ref: "#/components/schemas/UserPublic" }),
  V1AuthLoginResponse: envelopeSchema({ $ref: "#/components/schemas/AuthLoginData" }),
  V1AuthRefreshResponse: envelopeSchema({ $ref: "#/components/schemas/AuthRefreshData" }),
  V1ProductResponse: envelopeSchema({ $ref: "#/components/schemas/Product" }),
  V1ProductsPage: envelopeSchema(
    { type: "array", items: { $ref: "#/components/schemas/Product" } },
    true
  ),
  V1BulkProductsResponse: envelopeSchema({ $ref: "#/components/schemas/BulkProductsData" }),
  V1WarehouseResponse: envelopeSchema({ $ref: "#/components/schemas/Warehouse" }),
  V1WarehousesPage: envelopeSchema(
    { type: "array", items: { $ref: "#/components/schemas/Warehouse" } },
    true
  ),
  V1BulkWarehousesResponse: envelopeSchema({ $ref: "#/components/schemas/BulkWarehousesData" }),
  V1StockResponse: envelopeSchema({ $ref: "#/components/schemas/Stock" }),
  V1StocksPage: envelopeSchema(
    { type: "array", items: { $ref: "#/components/schemas/Stock" } },
    true
  ),
  V1BulkStocksResponse: envelopeSchema({ $ref: "#/components/schemas/BulkStocksData" }),
  V1StockMovementResponse: envelopeSchema({ $ref: "#/components/schemas/StockMovement" }),
  V1StockMovementsPage: envelopeSchema(
    { type: "array", items: { $ref: "#/components/schemas/StockMovement" } },
    true
  ),
  V1InventoryMutationResponse: envelopeSchema({
    $ref: "#/components/schemas/InventoryMutationData",
  }),
  V1BulkInventoryMutationResponse: envelopeSchema({
    $ref: "#/components/schemas/BulkInventoryMutationData",
  }),
};
Object.assign(swaggerSpec.components.schemas, successSchemas);
for (const legacySchemaName of [
  "BulkProductsResponse",
  "BulkWarehousesResponse",
  "BulkStocksResponse",
  "BulkGoodsReceiptResponse",
  "BulkGoodsIssueResponse",
]) {
  delete swaggerSpec.components.schemas[legacySchemaName];
}

swaggerSpec.paths["/"] = {
  get: {
    summary: "Describe the running API service",
    tags: ["Operations"],
    responses: {
      200: {
        description: "The API process is running",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RootResponse" },
          },
        },
      },
    },
  },
};

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
      "Optional opaque, case-sensitive key (8-128 characters; A-Z, a-z, 0-9, dot, underscore, colon, and hyphen). It is scoped to the current authenticated actor and stable business operation. The raw key is never stored; its SHA-256 digest and contract-neutral successful result are retained for seven days. Reusing the key with the same normalized command replays the result through the requested API contract, while a different command conflicts.",
    schema: {
      type: "string",
      minLength: 8,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    },
  },
  Limit: {
    name: "limit",
    in: "query",
    required: false,
    description: "Maximum records returned. Defaults to 50 and is capped at 100.",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
  Cursor: {
    name: "cursor",
    in: "query",
    required: false,
    description:
      "Opaque base64url continuation token. It is resource-, sort-, order-, and normalized-filter-specific and is invalidated when those values change.",
    schema: { type: "string", minLength: 1, maxLength: 1024 },
  },
  CreatedAtSort: {
    name: "sort",
    in: "query",
    required: false,
    schema: { type: "string", enum: ["createdAt"], default: "createdAt" },
  },
  SortOrder: {
    name: "order",
    in: "query",
    required: false,
    schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
  },
  StatusFilter: {
    name: "status",
    in: "query",
    required: false,
    schema: { type: "string", enum: ["active", "inactive"] },
  },
  ProductSkuFilter: {
    name: "sku",
    in: "query",
    required: false,
    description: "Exact SKU match after trimming and uppercase normalization.",
    schema: { type: "string", minLength: 1, maxLength: 64 },
  },
  WarehouseCodeFilter: {
    name: "code",
    in: "query",
    required: false,
    description: "Exact warehouse code after trimming and uppercase normalization.",
    schema: { type: "string", minLength: 1, maxLength: 64 },
  },
  ProductIdFilter: {
    name: "productId",
    in: "query",
    required: false,
    schema: objectId,
  },
  WarehouseIdFilter: {
    name: "warehouseId",
    in: "query",
    required: false,
    schema: objectId,
  },
  StockIdFilter: {
    name: "stockId",
    in: "query",
    required: false,
    schema: objectId,
  },
  MovementTypeFilter: {
    name: "type",
    in: "query",
    required: false,
    schema: { type: "string", enum: ["GOODS_RECEIPT", "GOODS_ISSUE"] },
  },
  MovementReferenceFilter: {
    name: "reference",
    in: "query",
    required: false,
    description: "Exact trimmed reference match.",
    schema: { type: "string", minLength: 1, maxLength: 500 },
  },
  MovementFromFilter: {
    name: "from",
    in: "query",
    required: false,
    description: "Inclusive createdAt lower bound with an explicit timezone.",
    schema: { type: "string", format: "date-time" },
  },
  MovementToFilter: {
    name: "to",
    in: "query",
    required: false,
    description: "Inclusive createdAt upper bound with an explicit timezone.",
    schema: { type: "string", format: "date-time" },
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

const addParameterReferences = (operation, names) => {
  operation.parameters = operation.parameters || [];
  for (const name of names) {
    const reference = `#/components/parameters/${name}`;
    if (!operation.parameters.some((parameter) => parameter.$ref === reference)) {
      operation.parameters.push({ $ref: reference });
    }
  }
};

const collectionOperations = [
  {
    path: "/api/v1/products",
    parameters: ["StatusFilter", "ProductSkuFilter"],
    schema: "V1ProductsPage",
  },
  {
    path: "/api/v1/warehouses",
    parameters: ["StatusFilter", "WarehouseCodeFilter"],
    schema: "V1WarehousesPage",
  },
  {
    path: "/api/v1/stocks",
    parameters: ["ProductIdFilter", "WarehouseIdFilter", "StatusFilter"],
    schema: "V1StocksPage",
  },
  {
    path: "/api/v1/stock-movements",
    parameters: [
      "StockIdFilter",
      "ProductIdFilter",
      "WarehouseIdFilter",
      "MovementTypeFilter",
      "MovementReferenceFilter",
      "MovementFromFilter",
      "MovementToFilter",
    ],
    schema: "V1StockMovementsPage",
  },
];

for (const { path, parameters, schema } of collectionOperations) {
  const operation = swaggerSpec.paths[path]?.get;
  if (!operation) continue;
  addParameterReferences(operation, [
    "Limit",
    "Cursor",
    "CreatedAtSort",
    "SortOrder",
    ...parameters,
  ]);
  operation.description = `${operation.description || ""} Results use deterministic createdAt/_id cursor pagination, fetch no total count, and are not snapshot-isolated across concurrent writes. Unknown query parameters and incompatible cursors are rejected.`.trim();
  operation.responses["400"] = {
    description: "Validation failed or cursor is invalid/incompatible",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/V1Error" } },
    },
    "x-error-codes": ["VALIDATION_FAILED", "INVALID_CURSOR"],
  };
  operation.responses["200"].content = {
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  };
}

const successSchemaByOperation = Object.freeze({
  "post /api/v1/auth/login": "V1AuthLoginResponse",
  "post /api/v1/auth/refresh": "V1AuthRefreshResponse",
  "post /api/v1/auth/logout": "V1NullResponse",
  "get /api/v1/auth/me": "V1UserResponse",
  "post /api/v1/users": "V1UserResponse",
  "get /api/v1/products": "V1ProductsPage",
  "post /api/v1/products": "V1ProductResponse",
  "get /api/v1/products/{id}": "V1ProductResponse",
  "patch /api/v1/products/{id}": "V1ProductResponse",
  "patch /api/v1/products/{id}/deactivate": "V1ProductResponse",
  "delete /api/v1/products/{id}": "V1NullResponse",
  "post /api/v1/products/bulk": "V1BulkProductsResponse",
  "patch /api/v1/products/bulk": "V1BulkProductsResponse",
  "delete /api/v1/products/bulk": "V1BulkProductsResponse",
  "get /api/v1/warehouses": "V1WarehousesPage",
  "post /api/v1/warehouses": "V1WarehouseResponse",
  "get /api/v1/warehouses/{id}": "V1WarehouseResponse",
  "patch /api/v1/warehouses/{id}": "V1WarehouseResponse",
  "patch /api/v1/warehouses/{id}/deactivate": "V1WarehouseResponse",
  "post /api/v1/warehouses/bulk": "V1BulkWarehousesResponse",
  "patch /api/v1/warehouses/bulk": "V1BulkWarehousesResponse",
  "get /api/v1/stocks": "V1StocksPage",
  "post /api/v1/stocks": "V1StockResponse",
  "get /api/v1/stocks/{id}": "V1StockResponse",
  "post /api/v1/stocks/bulk": "V1BulkStocksResponse",
  "get /api/v1/stock-movements": "V1StockMovementsPage",
  "get /api/v1/stock-movements/{id}": "V1StockMovementResponse",
  "post /api/v1/goods-receipts": "V1InventoryMutationResponse",
  "post /api/v1/goods-receipts/bulk": "V1BulkInventoryMutationResponse",
  "post /api/v1/goods-issues": "V1InventoryMutationResponse",
  "post /api/v1/goods-issues/bulk": "V1BulkInventoryMutationResponse",
});

for (const [path, pathItem] of Object.entries(swaggerSpec.paths)) {
  if (!path.startsWith("/api/v1/")) continue;
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!httpMethods.has(method)) continue;
    const successSchema = successSchemaByOperation[`${method} ${path}`];
    for (const [status, response] of Object.entries(operation.responses || {})) {
      if (status.startsWith("2") && successSchema) {
        response.content = {
          "application/json": {
            schema: { $ref: `#/components/schemas/${successSchema}` },
          },
        };
      } else if (!status.startsWith("2")) {
        response.content = {
          "application/json": {
            schema: { $ref: "#/components/schemas/V1Error" },
          },
        };
      }
    }
  }
}

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
  const canonicalPath = path.replace(/^\/api\//, "/api/v1/");
  const operation = swaggerSpec.paths[canonicalPath]?.[method];
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
  operation.description = `${operation.description || ""} Optional idempotency is evaluated after current authentication, authorization, and normalized validation. A contract-neutral successful result is stored atomically for seven days and presented through the requested HTTP contract on replay; conflicting payloads or an unresolved concurrent request return 409. Invalid idempotency headers return 400; invalid request or correlation IDs are replaced with safe effective values.`.trim();
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
