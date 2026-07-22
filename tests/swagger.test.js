const SwaggerParser = require("@apidevtools/swagger-parser");

const defaultProductionUrl =
  "https://inventory-management-api-6zuo.onrender.com";
const originalProductionUrl = process.env.SWAGGER_PRODUCTION_URL;

const loadSwaggerSpec = () => {
  jest.resetModules();
  return require("../src/config/swagger");
};

delete process.env.SWAGGER_PRODUCTION_URL;
const swaggerSpec = loadSwaggerSpec();

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
        BulkProductsResponse: expect.any(Object),
        BulkWarehousesResponse: expect.any(Object),
        BulkStocksResponse: expect.any(Object),
        BulkGoodsReceiptResponse: expect.any(Object),
        BulkGoodsIssueResponse: expect.any(Object),
      })
    );
  });
});
