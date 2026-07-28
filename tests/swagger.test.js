const SwaggerParser = require("@apidevtools/swagger-parser");
const {
  mutationOperationRegistry,
} = require("../src/services/inventoryOperationRegistry");

const defaultProductionUrl =
  "https://inventory-management-api-6zuo.onrender.com";
const originalProductionUrl = process.env.SWAGGER_PRODUCTION_URL;

const loadSwaggerSpec = () => {
  jest.resetModules();
  return require("../src/config/swagger");
};

delete process.env.SWAGGER_PRODUCTION_URL;
const swaggerSpec = loadSwaggerSpec();

const httpMethods = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
]);

const parameterName = (parameter) => {
  if (parameter.name) return parameter.name;
  if (parameter.$ref === "#/components/parameters/RequestId") {
    return "X-Request-ID";
  }
  if (parameter.$ref === "#/components/parameters/CorrelationId") {
    return "X-Correlation-ID";
  }
  if (parameter.$ref === "#/components/parameters/IdempotencyKey") {
    return "Idempotency-Key";
  }
  return parameter.$ref;
};

const documentedOperations = () =>
  Object.entries(swaggerSpec.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => httpMethods.has(method))
      .map(([method, operation]) => ({ method, path, operation }))
  );

const protectedOperations = [
  ["get", "/api/auth/me"],
  ["post", "/api/users"],
  ["get", "/api/products"],
  ["post", "/api/products"],
  ["get", "/api/products/{id}"],
  ["patch", "/api/products/{id}"],
  ["patch", "/api/products/{id}/deactivate"],
  ["delete", "/api/products/{id}"],
  ["post", "/api/products/bulk"],
  ["patch", "/api/products/bulk"],
  ["delete", "/api/products/bulk"],
  ["get", "/api/warehouses"],
  ["post", "/api/warehouses"],
  ["get", "/api/warehouses/{id}"],
  ["patch", "/api/warehouses/{id}"],
  ["patch", "/api/warehouses/{id}/deactivate"],
  ["post", "/api/warehouses/bulk"],
  ["patch", "/api/warehouses/bulk"],
  ["get", "/api/stocks"],
  ["post", "/api/stocks"],
  ["get", "/api/stocks/{id}"],
  ["post", "/api/stocks/bulk"],
  ["get", "/api/stock-movements"],
  ["get", "/api/stock-movements/{id}"],
  ["post", "/api/goods-receipts"],
  ["post", "/api/goods-receipts/bulk"],
  ["post", "/api/goods-issues"],
  ["post", "/api/goods-issues/bulk"],
];

const roleProtectedOperations = protectedOperations.filter(
  ([, path]) => path !== "/api/auth/me"
);

const operationsWithServerErrors = [
  ["post", "/api/auth/login"],
  ["post", "/api/auth/refresh"],
  ["post", "/api/auth/logout"],
  ...protectedOperations,
];

describe("Swagger/OpenAPI specification", () => {
  afterEach(() => {
    if (originalProductionUrl === undefined) {
      delete process.env.SWAGGER_PRODUCTION_URL;
    } else {
      process.env.SWAGGER_PRODUCTION_URL = originalProductionUrl;
    }
  });

  it("is a formally valid OpenAPI document", async () => {
    await expect(SwaggerParser.validate(swaggerSpec)).resolves.toBeDefined();
  });

  it("defines the basic OpenAPI structure and bearer authentication", () => {
    expect(swaggerSpec.openapi).toBeDefined();
    expect(swaggerSpec.info.title).toBeDefined();
    expect(swaggerSpec.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it("defines exact reusable incoming request and correlation contracts", () => {
    const requestId = swaggerSpec.components.parameters.RequestId;
    const parameter = swaggerSpec.components.parameters.CorrelationId;

    expect(requestId).toMatchObject({
      name: "X-Request-ID",
      in: "header",
      required: false,
      schema: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
      },
    });
    expect(requestId.description).toContain("server-generated UUID");
    expect(requestId.description).toContain("Invalid or missing values");
    expect(parameter).toMatchObject({
      name: "X-Correlation-ID",
      in: "header",
      required: false,
      schema: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
      },
    });
    expect(parameter.description).toContain("caller-provided operation chain");
    expect(parameter.description).toContain("echoed");
    expect(parameter.description).toContain("effective request ID");
    expect(parameter.description).toContain("invalid or missing value");
    expect(parameter.description).toContain(
      "does not define idempotency identity"
    );
    expect(parameter.description).toContain(
      "changing it does not prevent same-payload replay"
    );
  });

  it("documents both incoming context headers once on every operation", () => {
    for (const { method, path, operation } of documentedOperations()) {
      const parameters = operation.parameters || [];
      const requestParameters = parameters.filter(
        (parameter) => parameterName(parameter) === "X-Request-ID"
      );
      const correlationParameters = parameters.filter(
        (parameter) => parameterName(parameter) === "X-Correlation-ID"
      );

      expect(requestParameters).toHaveLength(1);
      expect(requestParameters[0]).toMatchObject({ required: false });
      expect(correlationParameters).toHaveLength(1);
      expect(correlationParameters[0]).toMatchObject({ required: false });
      expect(operation).toBe(swaggerSpec.paths[path][method]);
    }
    expect(swaggerSpec.components.parameters.RequestId).toBeDefined();
  });

  it("does not claim invalid context IDs produce a 400 response", () => {
    for (const { operation } of documentedOperations()) {
      const response = operation.responses["400"];
      expect(response?.["x-request-context-errors"]).toBeUndefined();
    }
  });

  it.each([
    ["/api/products", "get"],
    ["/api/warehouses", "get"],
    ["/api/stocks", "get"],
    ["/api/stock-movements", "get"],
  ])("does not invent a context-validation 400 for %s %s", (path, method) => {
    const specWithRefs = loadSwaggerSpec();
    const response = specWithRefs.paths[path][method].responses["400"];

    expect(response).toBeUndefined();
  });

  it("preserves existing validation and resource-ID 400 response contracts", () => {
    const specWithRefs = loadSwaggerSpec();
    const productCreate = specWithRefs.paths["/api/products"].post.responses["400"];
    const productById =
      specWithRefs.paths["/api/products/{id}"].get.responses["400"];
    const userCreate = specWithRefs.paths["/api/users"].post.responses["400"];

    expect(productCreate.description).toBe("Validation failed");
    expect(productCreate.content).toBeUndefined();
    expect(productCreate["x-request-context-errors"]).toBeUndefined();
    expect(productById.description).toBe("Invalid product ID");
    expect(productById.content).toBeUndefined();
    expect(productById["x-request-context-errors"]).toBeUndefined();
    expect(userCreate).toMatchObject({
      description: "Validation failed",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/ValidationErrorResponse",
          },
        },
      },
    });
  });

  it("does not duplicate operation parameters", () => {
    for (const { operation } of documentedOperations()) {
      const identities = (operation.parameters || []).map((parameter) =>
        parameter.$ref || `${parameter.in}:${parameterName(parameter)}`
      );
      expect(new Set(identities).size).toBe(identities.length);
    }
  });

  it("lists local and Render production servers", () => {
    const serverUrls = swaggerSpec.servers.map((server) => server.url);

    expect(serverUrls).toContain("http://localhost:3000");
    expect(serverUrls).toContain(
      defaultProductionUrl
    );
  });

  it("supports a production server URL override", () => {
    const overrideUrl = "https://inventory-api.example.com";
    process.env.SWAGGER_PRODUCTION_URL = overrideUrl;

    const overriddenSpec = loadSwaggerSpec();
    const serverUrls = overriddenSpec.servers.map((server) => server.url);

    expect(serverUrls).toContain("http://localhost:3000");
    expect(serverUrls).toContain(overrideUrl);
  });

  it.each([
    ["/api/products/bulk", ["post", "patch", "delete"]],
    ["/api/warehouses/bulk", ["post", "patch"]],
    ["/api/stocks/bulk", ["post"]],
    ["/api/goods-receipts/bulk", ["post"]],
    ["/api/goods-issues/bulk", ["post"]],
  ])("documents bulk operations for %s", (path, methods) => {
    expect(swaggerSpec.paths[path]).toBeDefined();

    for (const method of methods) {
      expect(swaggerSpec.paths[path][method]).toBeDefined();
    }
  });

  it("does not expose forbidden registration or stock movement creation", () => {
    expect(swaggerSpec.paths["/api/auth/register"]).toBeUndefined();
    expect(swaggerSpec.paths["/api/stock-movements"].post).toBeUndefined();
    expect(
      swaggerSpec.paths["/api/stock-movements/{id}"].post
    ).toBeUndefined();
  });

  it("does not introduce future API, event, worker, or webhook contracts", () => {
    const serializedSpec = JSON.stringify(swaggerSpec);

    expect(Object.keys(swaggerSpec.paths)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^\/api\/v1(?:\/|$)/)])
    );
    expect(serializedSpec).not.toMatch(
      /AuditEvent|OutboxEvent|AsyncLocalStorage|Redis|webhook|worker/i
    );
  });

  it.each([
    ["/health/live", false, "Check process liveness"],
    ["/health", false, "Check process liveness (legacy alias)"],
    ["/health/ready", true, "Check application readiness"],
    [
      "/api/ready",
      true,
      "Check application readiness (WP6 compatibility alias)",
    ],
  ])("documents the unauthenticated operational contract for %s", (path, readiness, summary) => {
    const operation = loadSwaggerSpec().paths[path].get;

    expect(operation.security).toBeUndefined();
    expect(operation.summary).toBe(summary);
    expect(operation.responses["200"]).toBeDefined();
    expect(
      operation.responses["200"].content["application/json"].schema.$ref
    ).toBe(
      readiness
        ? "#/components/schemas/ReadinessResponse"
        : "#/components/schemas/LivenessResponse"
    );
    if (readiness) {
      expect(operation.responses["503"]).toBeDefined();
      expect(
        operation.responses["503"].content["application/json"].schema.$ref
      ).toBe("#/components/schemas/ReadinessResponse");
    } else {
      expect(operation.responses["503"]).toBeUndefined();
    }
  });

  it("keeps stock movement paths read-only", () => {
    expect(Object.keys(swaggerSpec.paths["/api/stock-movements"])).toEqual([
      "get",
    ]);
    expect(
      Object.keys(swaggerSpec.paths["/api/stock-movements/{id}"])
    ).toEqual(["get"]);
  });

  it.each(protectedOperations)(
    "documents bearer authentication and auth responses for %s %s",
    (method, path) => {
      const operation = swaggerSpec.paths[path][method];

      expect(operation).toBeDefined();
      expect(operation.security).toEqual(
        expect.arrayContaining([expect.objectContaining({ bearerAuth: [] })])
      );
      expect(operation.responses["401"]).toBeDefined();
      expect(operation.responses["403"]).toBeDefined();
    }
  );

  it("documents the inactive-account response for the current-user endpoint", () => {
    expect(swaggerSpec.paths["/api/auth/me"].get.responses["403"]).toEqual({
      description: "User account is inactive",
      headers: {
        "X-Request-ID": expect.objectContaining({
          schema: expect.objectContaining({
            type: "string",
            maxLength: 128,
          }),
        }),
        "X-Correlation-ID": expect.objectContaining({
          schema: expect.objectContaining({ type: "string", maxLength: 128 }),
        }),
      },
    });
  });

  it.each(roleProtectedOperations)(
    "documents both inactive-account and role-denial cases for %s %s",
    (method, path) => {
      expect(swaggerSpec.paths[path][method].responses["403"].description).toBe(
        "User account is inactive or access is denied"
      );
    }
  );

  it.each(operationsWithServerErrors)(
    "documents unexpected server errors for %s %s",
    (method, path) => {
      expect(swaggerSpec.paths[path][method].responses["500"]).toBeDefined();
    }
  );

  it.each([
    ["/api/products/bulk", "post", "array"],
    ["/api/products/bulk", "patch", "array"],
    ["/api/products/bulk", "delete", "object"],
    ["/api/warehouses/bulk", "post", "array"],
    ["/api/warehouses/bulk", "patch", "array"],
    ["/api/stocks/bulk", "post", "array"],
    ["/api/goods-receipts/bulk", "post", "array"],
    ["/api/goods-issues/bulk", "post", "array"],
  ])("documents the %s %s body as %s", (path, method, type) => {
    const schema =
      swaggerSpec.paths[path][method].requestBody.content["application/json"]
        .schema;

    expect(schema.type).toBe(type);
  });

  it("documents product bulk deletion with an ids array", () => {
    const schema =
      swaggerSpec.paths["/api/products/bulk"].delete.requestBody.content[
        "application/json"
      ].schema;

    expect(schema.required).toContain("ids");
    expect(schema.properties.ids.type).toBe("array");
  });

  it("limits user creation roles to manager and viewer", () => {
    const roleSchema =
      swaggerSpec.paths["/api/users"].post.requestBody.content[
        "application/json"
      ].schema.properties.role;

    expect(roleSchema.enum).toEqual(["manager", "viewer"]);
  });

  it("documents precise single product and warehouse update schemas", () => {
    const productSchema =
      swaggerSpec.paths["/api/products/{id}"].patch.requestBody.content[
        "application/json"
      ].schema;
    const warehouseSchema =
      swaggerSpec.paths["/api/warehouses/{id}"].patch.requestBody.content[
        "application/json"
      ].schema;

    expect(productSchema.minProperties).toBe(1);
    expect(warehouseSchema.minProperties).toBe(1);
    expect(productSchema.properties.expectedVersion).toMatchObject({
      type: "integer",
      minimum: 1,
    });
    expect(warehouseSchema.properties.expectedVersion).toMatchObject({
      type: "integer",
      minimum: 1,
    });
    expect(warehouseSchema.properties.code).toBeUndefined();
  });

  it("marks legacy Product DELETE operations as deprecated archive aliases", () => {
    expect(swaggerSpec.paths["/api/products/{id}"].delete.deprecated).toBe(true);
    expect(swaggerSpec.paths["/api/products/bulk"].delete.deprecated).toBe(true);
    expect(
      swaggerSpec.paths["/api/products/{id}"].delete.description
    ).toContain("retains the Product");
  });

  it("documents Product create and update conflicts on the correct operations", () => {
    const createConflict =
      swaggerSpec.paths["/api/products"].post.responses["409"].description;
    const updateConflict =
      swaggerSpec.paths["/api/products/{id}"].patch.responses["409"].description;

    expect(createConflict).toBe("Product with this SKU already exists");
    expect(createConflict).toContain("SKU");
    expect(createConflict.toLowerCase()).not.toContain("stale");
    expect(createConflict).not.toContain("version");
    expect(updateConflict).toBe(
      "Product with this SKU already exists or the expected version is stale"
    );
    expect(updateConflict).toContain("SKU");
    expect(updateConflict.toLowerCase()).toContain("stale");
  });

  it("documents aggregate versions, lifecycle guards, and movement history fields", () => {
    const { Product, Warehouse, Stock, StockMovement } =
      swaggerSpec.components.schemas;

    expect(Product.properties.version).toMatchObject({
      type: "integer",
      minimum: 1,
      readOnly: true,
    });
    expect(Warehouse.properties.deactivatedAt.readOnly).toBe(true);
    expect(Stock.properties.productLifecycleStatus).toMatchObject({
      readOnly: true,
      enum: ["active", "inactive", "archived"],
    });
    expect(Stock.properties.warehouseLifecycleStatus.readOnly).toBe(true);
    expect(StockMovement.properties).toEqual(
      expect.objectContaining({
        productId: expect.any(Object),
        warehouseId: expect.any(Object),
        quantityBefore: expect.any(Object),
        quantityAfter: expect.any(Object),
        aggregateVersion: expect.any(Object),
        productSnapshot: expect.any(Object),
        warehouseSnapshot: expect.any(Object),
      })
    );
  });

  it.each([
    ["/api/products/bulk", "post", "BulkProductsResponse"],
    ["/api/products/bulk", "patch", "BulkProductsResponse"],
    ["/api/products/bulk", "delete", "BulkProductsResponse"],
    ["/api/warehouses/bulk", "post", "BulkWarehousesResponse"],
    ["/api/warehouses/bulk", "patch", "BulkWarehousesResponse"],
    ["/api/stocks/bulk", "post", "BulkStocksResponse"],
    ["/api/goods-receipts/bulk", "post", "BulkGoodsReceiptResponse"],
    ["/api/goods-issues/bulk", "post", "BulkGoodsIssueResponse"],
  ])("uses %s %s response schema %s", (path, method, schemaName) => {
    const specWithRefs = loadSwaggerSpec();
    const responseSchema =
      specWithRefs.paths[path][method].responses[method === "patch" || method === "delete" ? "200" : "201"]
        .content["application/json"].schema;

    expect(responseSchema.$ref).toBe(`#/components/schemas/${schemaName}`);
  });

  it("documents validation limits and inactive receipt conflicts", () => {
    const productSchema =
      swaggerSpec.paths["/api/products"].post.requestBody.content[
        "application/json"
      ].schema;
    const warehouseSchema =
      swaggerSpec.paths["/api/warehouses"].post.requestBody.content[
        "application/json"
      ].schema;
    const receiptSchema =
      swaggerSpec.paths["/api/goods-receipts"].post.requestBody.content[
        "application/json"
      ].schema;

    expect(productSchema.properties.sku).toMatchObject({
      maxLength: 64,
      pattern: "^[A-Z0-9_-]+$",
    });
    expect(warehouseSchema.properties.code).toMatchObject({
      maxLength: 64,
      pattern: "^[A-Z0-9_-]+$",
    });
    expect(receiptSchema.properties.reference.maxLength).toBe(100);
    expect(receiptSchema.properties.reason.maxLength).toBe(500);
    expect(swaggerSpec.paths["/api/goods-receipts"].post.responses["409"]).toBeDefined();
    expect(
      swaggerSpec.paths["/api/goods-receipts/bulk"].post.responses["409"]
    ).toBeDefined();
  });

  it("defines pragmatic reusable response schemas", () => {
    expect(swaggerSpec.components.schemas).toEqual(
      expect.objectContaining({
        ErrorResponse: expect.any(Object),
        ValidationErrorResponse: expect.any(Object),
        SuccessMessageResponse: expect.any(Object),
        LivenessResponse: expect.any(Object),
        ReadinessResponse: expect.any(Object),
        BulkProductsResponse: expect.any(Object),
        BulkWarehousesResponse: expect.any(Object),
        BulkStocksResponse: expect.any(Object),
        BulkGoodsReceiptResponse: expect.any(Object),
        BulkGoodsIssueResponse: expect.any(Object),
      })
    );
  });

  it.each(mutationOperationRegistry)(
    "documents idempotency on $method $path",
    ({ method, path, operationId }) => {
      const operation = swaggerSpec.paths[path][method];
      expect(operation.operationId).toBe(operationId);
      expect(operation.parameters).toContainEqual(
        expect.objectContaining({
          name: "Idempotency-Key",
          in: "header",
          required: false,
        })
      );
      expect(operation.parameters).toContainEqual(
        expect.objectContaining({
          name: "X-Request-ID",
          in: "header",
          required: false,
        })
      );
      expect(operation.parameters).toContainEqual(
        expect.objectContaining({
          name: "X-Correlation-ID",
          in: "header",
          required: false,
        })
      );
      expect(operation.description).toContain("exact replay");
      expect(operation.description).toContain("return 409");
      expect(operation.responses["400"]).toBeDefined();
      expect(operation.responses["409"]).toBeDefined();
      expect(
        operation.responses["400"]["x-request-context-errors"]
      ).toBeUndefined();
      expect(operation.responses["400"]["x-idempotency-errors"]).toEqual([
        "INVALID_IDEMPOTENCY_KEY",
      ]);
      expect(new Set(operation.responses["400"]["x-idempotency-errors"]).size)
        .toBe(operation.responses["400"]["x-idempotency-errors"].length);
      expect(operation.responses["409"]["x-idempotency-errors"]).toEqual(
        expect.arrayContaining([
          "IDEMPOTENCY_CONFLICT",
          "IDEMPOTENCY_IN_PROGRESS",
        ])
      );
      expect(new Set(operation.responses["409"]["x-idempotency-errors"]).size)
        .toBe(operation.responses["409"]["x-idempotency-errors"].length);

      for (const response of Object.values(operation.responses)) {
        expect(response.headers).toEqual(
          expect.objectContaining({
            "X-Request-ID": expect.objectContaining({
              schema: expect.objectContaining({
                type: "string",
                maxLength: 128,
              }),
            }),
            "X-Correlation-ID": expect.objectContaining({
              schema: expect.objectContaining({ type: "string" }),
            }),
            "Idempotency-Replayed": expect.objectContaining({
              schema: expect.objectContaining({ enum: ["true", "false"] }),
            }),
          })
        );
      }
    }
  );

  it("limits Idempotency-Key to exactly the 18 registered Inventory Core mutations", () => {
    const registeredMutations = new Set(
      mutationOperationRegistry.map(({ method, path }) => `${method} ${path}`)
    );

    expect(mutationOperationRegistry).toHaveLength(18);
    for (const { method, path, operation } of documentedOperations()) {
      const hasIdempotencyKey = (operation.parameters || [])
        .map(parameterName)
        .includes("Idempotency-Key");

      expect(hasIdempotencyKey).toBe(
        registeredMutations.has(`${method} ${path}`)
      );
    }
  });

  it("documents context but not idempotency on GET operations", () => {
    for (const { method, operation } of documentedOperations()) {
      if (method !== "get") continue;
      const names = (operation.parameters || []).map(parameterName);

      expect(names).toContain("X-Request-ID");
      expect(names).toContain("X-Correlation-ID");
      expect(names).not.toContain("Idempotency-Key");
    }
  });

  it("documents request/correlation headers on every documented response", () => {
    for (const pathItem of Object.values(swaggerSpec.paths)) {
      for (const operation of Object.values(pathItem)) {
        if (!operation.responses) continue;
        for (const response of Object.values(operation.responses)) {
          expect(response.headers).toEqual(
            expect.objectContaining({
              "X-Request-ID": expect.objectContaining({
                schema: expect.objectContaining({
                  type: "string",
                  maxLength: 128,
                }),
              }),
              "X-Correlation-ID": expect.objectContaining({
                schema: expect.objectContaining({ type: "string" }),
              }),
            })
          );
        }
      }
    }
  });
});
