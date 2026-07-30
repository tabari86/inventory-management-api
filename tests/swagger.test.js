const SwaggerParser = require("@apidevtools/swagger-parser");
const {
  validateOpenApi,
  validatePublicContent,
} = require("../scripts/validateOpenApi");
const {
  mutationOperationRegistry,
} = require("../src/services/inventoryOperationRegistry");

const defaultProductionUrl =
  "https://inventory-management-api-6zuo.onrender.com";
const loadSwaggerSpec = (productionServerUrl) => {
  jest.resetModules();
  const document = require("../src/config/swagger");
  return productionServerUrl
    ? document.createSwaggerSpec({ productionServerUrl })
    : document;
};

const swaggerSpec = loadSwaggerSpec();
const cloneSwaggerSpec = () => JSON.parse(JSON.stringify(swaggerSpec));

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
  ["get", "/api/v1/auth/me"],
  ["post", "/api/v1/users"],
  ["get", "/api/v1/products"],
  ["post", "/api/v1/products"],
  ["get", "/api/v1/products/{id}"],
  ["patch", "/api/v1/products/{id}"],
  ["patch", "/api/v1/products/{id}/deactivate"],
  ["delete", "/api/v1/products/{id}"],
  ["post", "/api/v1/products/bulk"],
  ["patch", "/api/v1/products/bulk"],
  ["delete", "/api/v1/products/bulk"],
  ["get", "/api/v1/warehouses"],
  ["post", "/api/v1/warehouses"],
  ["get", "/api/v1/warehouses/{id}"],
  ["patch", "/api/v1/warehouses/{id}"],
  ["patch", "/api/v1/warehouses/{id}/deactivate"],
  ["post", "/api/v1/warehouses/bulk"],
  ["patch", "/api/v1/warehouses/bulk"],
  ["get", "/api/v1/stocks"],
  ["post", "/api/v1/stocks"],
  ["get", "/api/v1/stocks/{id}"],
  ["post", "/api/v1/stocks/bulk"],
  ["get", "/api/v1/stock-movements"],
  ["get", "/api/v1/stock-movements/{id}"],
  ["post", "/api/v1/goods-receipts"],
  ["post", "/api/v1/goods-receipts/bulk"],
  ["post", "/api/v1/goods-issues"],
  ["post", "/api/v1/goods-issues/bulk"],
];

const roleProtectedOperations = protectedOperations.filter(
  ([, path]) => path !== "/api/v1/auth/me"
);

const operationsWithServerErrors = [
  ["post", "/api/v1/auth/login"],
  ["post", "/api/v1/auth/refresh"],
  ["post", "/api/v1/auth/logout"],
  ...protectedOperations,
];

describe("Swagger/OpenAPI specification", () => {
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
    ["/api/v1/products", "get"],
    ["/api/v1/warehouses", "get"],
    ["/api/v1/stocks", "get"],
    ["/api/v1/stock-movements", "get"],
  ])("documents bounded-query validation for %s %s", (path, method) => {
    const specWithRefs = loadSwaggerSpec();
    const response = specWithRefs.paths[path][method].responses["400"];

    expect(response["x-request-context-errors"]).toBeUndefined();
    expect(response["x-error-codes"]).toEqual([
      "VALIDATION_FAILED",
      "INVALID_CURSOR",
    ]);
    expect(response.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/V1Error"
    );
  });

  it("preserves existing validation and resource-ID 400 response contracts", () => {
    const specWithRefs = loadSwaggerSpec();
    const productCreate = specWithRefs.paths["/api/v1/products"].post.responses["400"];
    const productById =
      specWithRefs.paths["/api/v1/products/{id}"].get.responses["400"];
    const userCreate = specWithRefs.paths["/api/v1/users"].post.responses["400"];

    expect(productCreate.description).toBe("Validation failed");
    expect(productCreate.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/V1Error"
    );
    expect(productCreate["x-request-context-errors"]).toBeUndefined();
    expect(productById.description).toBe("Invalid product ID");
    expect(productById.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/V1Error"
    );
    expect(productById["x-request-context-errors"]).toBeUndefined();
    expect(userCreate).toMatchObject({
      description: "Validation failed",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/V1Error",
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
    const overriddenSpec = loadSwaggerSpec(overrideUrl);
    const serverUrls = overriddenSpec.servers.map((server) => server.url);

    expect(serverUrls).toContain("http://localhost:3000");
    expect(serverUrls).toContain(overrideUrl);
  });

  it("contains no credentials, connection strings, private keys, or token literals", () => {
    const serializedSpec = JSON.stringify(swaggerSpec);
    const privateKeyPrefix = ["-----", "BEGIN "].join("");

    expect(serializedSpec).not.toMatch(/mongodb(?:\+srv)?:\/\//i);
    expect(serializedSpec).not.toMatch(
      /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/
    );
    expect(serializedSpec).not.toContain(privateKeyPrefix);
  });

  it("rejects a generic credential-bearing HTTPS URL without exposing credentials", () => {
    const username = "url-user-marker";
    const password = "url-password-marker";
    const document = cloneSwaggerSpec();
    document.info.description += ` https://${username}:${password}@public.example.com/reference`;

    const errors = validatePublicContent(document);
    const serializedErrors = JSON.stringify(errors);

    expect(errors).toContain(
      "The OpenAPI document contains an HTTP(S) URL with credentials"
    );
    expect(serializedErrors).not.toContain(username);
    expect(serializedErrors).not.toContain(password);
  });

  it("rejects an internal-only hostname in an HTTP URL", () => {
    const document = cloneSwaggerSpec();
    document.info.description += " See https://inventory.service.internal/reference";

    expect(validatePublicContent(document)).toContain(
      "The OpenAPI document contains an internal-only hostname"
    );
  });

  it.each([
    "10.20.30.40",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.20.10",
    "169.254.20.10",
  ])("rejects the private or link-local IPv4 host %s", (hostname) => {
    const document = cloneSwaggerSpec();
    document.info.description += ` See http://${hostname}/reference`;

    expect(validatePublicContent(document)).toContain(
      "The OpenAPI document contains a private or link-local IPv4 host"
    );
  });

  it("does not treat ordinary prose containing internal as a URL", () => {
    const document = cloneSwaggerSpec();
    document.info.description += " Internal implementation notes are omitted.";

    expect(validatePublicContent(document)).toEqual([]);
  });

  it("allows the intentional localhost development URL", () => {
    const document = cloneSwaggerSpec();
    document.info.description += " See http://localhost:3000/api-docs";

    expect(validatePublicContent(document)).toEqual([]);
  });

  it("allows the public HTTPS Render production URL", () => {
    const document = cloneSwaggerSpec();
    document.info.description += ` See ${defaultProductionUrl}/api-docs`;

    expect(validatePublicContent(document)).toEqual([]);
  });

  it("passes complete public-content validation for the real Swagger document", async () => {
    await expect(validateOpenApi(swaggerSpec)).resolves.toBe(swaggerSpec);
  });

  it.each([
    ["/api/v1/products/bulk", ["post", "patch", "delete"]],
    ["/api/v1/warehouses/bulk", ["post", "patch"]],
    ["/api/v1/stocks/bulk", ["post"]],
    ["/api/v1/goods-receipts/bulk", ["post"]],
    ["/api/v1/goods-issues/bulk", ["post"]],
  ])("documents bulk operations for %s", (path, methods) => {
    expect(swaggerSpec.paths[path]).toBeDefined();

    for (const method of methods) {
      expect(swaggerSpec.paths[path][method]).toBeDefined();
    }
  });

  it("does not expose forbidden registration or stock movement creation", () => {
    expect(swaggerSpec.paths["/api/v1/auth/register"]).toBeUndefined();
    expect(swaggerSpec.paths["/api/v1/stock-movements"].post).toBeUndefined();
    expect(
      swaggerSpec.paths["/api/v1/stock-movements/{id}"].post
    ).toBeUndefined();
  });

  it("does not introduce future API, event, worker, or webhook contracts", () => {
    const serializedSpec = JSON.stringify(swaggerSpec);

    expect(Object.keys(swaggerSpec.paths)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\/api\/v1(?:\/|$)/)])
    );
    expect(
      Object.keys(swaggerSpec.paths).filter(
        (path) => /^\/api\/(?!v1(?:\/|$))/.test(path) && path !== "/api/ready"
      )
    ).toEqual([]);
    expect(serializedSpec).not.toMatch(
      /AuditEvent|OutboxEvent|AsyncLocalStorage|Redis|webhook|worker/i
    );
  });

  it.each([
    ["/", false, "Describe the running API service"],
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
      path === "/"
        ? "#/components/schemas/RootResponse"
        : readiness
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
    expect(Object.keys(swaggerSpec.paths["/api/v1/stock-movements"])).toEqual([
      "get",
    ]);
    expect(
      Object.keys(swaggerSpec.paths["/api/v1/stock-movements/{id}"])
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
    const specWithRefs = loadSwaggerSpec();
    expect(specWithRefs.paths["/api/v1/auth/me"].get.responses["403"]).toMatchObject({
      description: "User account is inactive",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/V1Error" },
        },
      },
      headers: {
        "X-Request-ID": { $ref: "#/components/headers/XRequestId" },
        "X-Correlation-ID": { $ref: "#/components/headers/XCorrelationId" },
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
    ["/api/v1/products/bulk", "post", "array"],
    ["/api/v1/products/bulk", "patch", "array"],
    ["/api/v1/products/bulk", "delete", "object"],
    ["/api/v1/warehouses/bulk", "post", "array"],
    ["/api/v1/warehouses/bulk", "patch", "array"],
    ["/api/v1/stocks/bulk", "post", "array"],
    ["/api/v1/goods-receipts/bulk", "post", "array"],
    ["/api/v1/goods-issues/bulk", "post", "array"],
  ])("documents the %s %s body as %s", (path, method, type) => {
    const schema =
      swaggerSpec.paths[path][method].requestBody.content["application/json"]
        .schema;

    expect(schema.type).toBe(type);
  });

  it("documents product bulk deletion with an ids array", () => {
    const schema =
      swaggerSpec.paths["/api/v1/products/bulk"].delete.requestBody.content[
        "application/json"
      ].schema;

    expect(schema.required).toContain("ids");
    expect(schema.properties.ids.type).toBe("array");
  });

  it("limits user creation roles to manager and viewer", () => {
    const roleSchema =
      swaggerSpec.paths["/api/v1/users"].post.requestBody.content[
        "application/json"
      ].schema.properties.role;

    expect(roleSchema.enum).toEqual(["manager", "viewer"]);
  });

  it("documents precise single product and warehouse update schemas", () => {
    const productSchema =
      swaggerSpec.paths["/api/v1/products/{id}"].patch.requestBody.content[
        "application/json"
      ].schema;
    const warehouseSchema =
      swaggerSpec.paths["/api/v1/warehouses/{id}"].patch.requestBody.content[
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
    expect(swaggerSpec.paths["/api/v1/products/{id}"].delete.deprecated).toBe(true);
    expect(swaggerSpec.paths["/api/v1/products/bulk"].delete.deprecated).toBe(true);
    expect(
      swaggerSpec.paths["/api/v1/products/{id}"].delete.description
    ).toContain("retains the Product");
  });

  it("documents Product create and update conflicts on the correct operations", () => {
    const createConflict =
      swaggerSpec.paths["/api/v1/products"].post.responses["409"].description;
    const updateConflict =
      swaggerSpec.paths["/api/v1/products/{id}"].patch.responses["409"].description;

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
    ["/api/v1/products/bulk", "post", "V1BulkProductsResponse"],
    ["/api/v1/products/bulk", "patch", "V1BulkProductsResponse"],
    ["/api/v1/products/bulk", "delete", "V1BulkProductsResponse"],
    ["/api/v1/warehouses/bulk", "post", "V1BulkWarehousesResponse"],
    ["/api/v1/warehouses/bulk", "patch", "V1BulkWarehousesResponse"],
    ["/api/v1/stocks/bulk", "post", "V1BulkStocksResponse"],
    ["/api/v1/goods-receipts/bulk", "post", "V1BulkInventoryMutationResponse"],
    ["/api/v1/goods-issues/bulk", "post", "V1BulkInventoryMutationResponse"],
  ])("uses %s %s response schema %s", (path, method, schemaName) => {
    const specWithRefs = loadSwaggerSpec();
    const responseSchema =
      specWithRefs.paths[path][method].responses[method === "patch" || method === "delete" ? "200" : "201"]
        .content["application/json"].schema;

    expect(responseSchema.$ref).toBe(`#/components/schemas/${schemaName}`);
  });

  it("documents validation limits and inactive receipt conflicts", () => {
    const productSchema =
      swaggerSpec.paths["/api/v1/products"].post.requestBody.content[
        "application/json"
      ].schema;
    const warehouseSchema =
      swaggerSpec.paths["/api/v1/warehouses"].post.requestBody.content[
        "application/json"
      ].schema;
    const receiptSchema =
      swaggerSpec.paths["/api/v1/goods-receipts"].post.requestBody.content[
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
    expect(swaggerSpec.components.parameters.ProductSkuFilter.schema).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 64,
    });
    expect(
      swaggerSpec.components.parameters.WarehouseCodeFilter.schema
    ).toEqual({ type: "string", minLength: 1, maxLength: 64 });
    expect(receiptSchema.properties.reference.maxLength).toBe(100);
    expect(receiptSchema.properties.reason.maxLength).toBe(500);
    expect(swaggerSpec.paths["/api/v1/goods-receipts"].post.responses["409"]).toBeDefined();
    expect(
      swaggerSpec.paths["/api/v1/goods-receipts/bulk"].post.responses["409"]
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
        V1Error: expect.any(Object),
        V1Meta: expect.any(Object),
        V1PaginationMeta: expect.any(Object),
        V1BulkProductsResponse: expect.any(Object),
        V1BulkWarehousesResponse: expect.any(Object),
        V1BulkStocksResponse: expect.any(Object),
        V1BulkInventoryMutationResponse: expect.any(Object),
      })
    );
  });

  it.each(mutationOperationRegistry)(
    "documents idempotency on $method $path",
    ({ method, path, operationId }) => {
      const canonicalPath = path.replace(/^\/api\//, "/api/v1/");
      const operation = swaggerSpec.paths[canonicalPath][method];
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
      expect(operation.description).toContain("contract-neutral");
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
      mutationOperationRegistry.map(
        ({ method, path }) =>
          `${method} ${path.replace(/^\/api\//, "/api/v1/")}`
      )
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

  it("describes the canonical and temporary compatibility prefixes", () => {
    expect(swaggerSpec["x-canonical-prefix"]).toBe("/api/v1");
    expect(swaggerSpec["x-legacy-compatibility-prefix"]).toBe("/api");
    expect(swaggerSpec.info.description).toContain("temporary /api");
    expect(swaggerSpec.info.description).toContain("X-Next-Cursor");
  });

  it.each([
    ["/api/v1/products", ["status", "sku"]],
    ["/api/v1/warehouses", ["status", "code"]],
    ["/api/v1/stocks", ["productId", "warehouseId", "status"]],
    [
      "/api/v1/stock-movements",
      ["stockId", "productId", "warehouseId", "type", "reference", "from", "to"],
    ],
  ])("documents cursor and filter allowlists for %s", (path, filterNames) => {
    const operation = swaggerSpec.paths[path].get;
    const names = operation.parameters.map(parameterName);
    expect(names).toEqual(
      expect.arrayContaining(["limit", "cursor", "sort", "order", ...filterNames])
    );
    expect(operation.responses["400"]["x-error-codes"]).toEqual([
      "VALIDATION_FAILED",
      "INVALID_CURSOR",
    ]);
    expect(operation.description).toContain("not snapshot-isolated");
  });

  it("uses v1 envelopes for every canonical success and error response", () => {
    const specWithRefs = loadSwaggerSpec();
    const operationsWithRefs = Object.entries(specWithRefs.paths).flatMap(
      ([path, pathItem]) =>
        Object.entries(pathItem)
          .filter(([method]) => httpMethods.has(method))
          .map(([, operation]) => ({ path, operation }))
    );
    for (const { path, operation } of operationsWithRefs) {
      if (!path.startsWith("/api/v1/")) continue;
      for (const [status, response] of Object.entries(operation.responses)) {
        const reference = response.content?.["application/json"]?.schema?.$ref;
        if (status.startsWith("2")) {
          expect(reference).toMatch(/^#\/components\/schemas\/V1/);
        } else {
          expect(reference).toBe("#/components/schemas/V1Error");
        }
      }
    }
    expect(swaggerSpec.components.schemas.V1Error.required).toEqual([
      "type",
      "title",
      "status",
      "code",
      "detail",
      "requestId",
      "correlationId",
      "retryable",
      "errors",
    ]);
    expect(JSON.stringify(swaggerSpec)).not.toContain(
      '"additionalProperties":true'
    );
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
