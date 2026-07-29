const request = require("supertest");

const app = require("../src/app");
const swaggerSpec = require("../src/config/swagger");
const { createErrorHandler } = require("../src/middleware/errorHandler");
const AuditEvent = require("../src/models/AuditEvent");
const OutboxEvent = require("../src/models/OutboxEvent");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const {
  createAccessToken,
  createManagerToken,
  createTestUser,
  createViewerToken,
} = require("./helpers/authTestHelper");
const {
  expectNoForbiddenFields,
  expectOnlyKeys,
} = require("./helpers/publicContractAssertions");

require("./setupTestDb");

const expectV1Error = (response, status, code) => {
  expect(response.statusCode).toBe(status);
  expect(Object.keys(response.body).sort()).toEqual(
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
    ].sort()
  );
  expect(response.body).toMatchObject({
    type: "inventory-error",
    status,
    code,
    retryable: expect.any(Boolean),
    errors: expect.any(Array),
  });
  expect(response.body.requestId).toBe(response.headers["x-request-id"]);
  expect(response.body.correlationId).toBe(
    response.headers["x-correlation-id"]
  );
};

const expectV1Resource = (value, schemaName) => {
  const schema = swaggerSpec.components.schemas[schemaName];
  expectOnlyKeys(value, Object.keys(schema.properties), schema.required);
  expectNoForbiddenFields(value);
};

const invalidResourceIdCases = [
  ["products", "Invalid product ID", Product],
  ["warehouses", "Invalid warehouse ID", Warehouse],
  ["stocks", "Invalid stock ID", Stock],
  ["stock-movements", "Invalid stock movement ID", StockMovement],
];

const routeMatrix = [
  ["post", "/auth/login"],
  ["post", "/auth/refresh"],
  ["post", "/auth/logout"],
  ["get", "/auth/me"],
  ["post", "/users"],
  ["get", "/products"],
  ["post", "/products"],
  ["get", "/products/507f1f77bcf86cd799439011"],
  ["patch", "/products/507f1f77bcf86cd799439011"],
  ["patch", "/products/507f1f77bcf86cd799439011/deactivate"],
  ["delete", "/products/507f1f77bcf86cd799439011"],
  ["post", "/products/bulk"],
  ["patch", "/products/bulk"],
  ["delete", "/products/bulk"],
  ["get", "/warehouses"],
  ["post", "/warehouses"],
  ["get", "/warehouses/507f1f77bcf86cd799439011"],
  ["patch", "/warehouses/507f1f77bcf86cd799439011"],
  ["patch", "/warehouses/507f1f77bcf86cd799439011/deactivate"],
  ["post", "/warehouses/bulk"],
  ["patch", "/warehouses/bulk"],
  ["get", "/stocks"],
  ["post", "/stocks"],
  ["get", "/stocks/507f1f77bcf86cd799439011"],
  ["post", "/stocks/bulk"],
  ["get", "/stock-movements"],
  ["get", "/stock-movements/507f1f77bcf86cd799439011"],
  ["post", "/goods-receipts"],
  ["post", "/goods-receipts/bulk"],
  ["post", "/goods-issues"],
  ["post", "/goods-issues/bulk"],
];

describe("WP7 API routing and HTTP contracts", () => {
  it.each(routeMatrix)(
    "keeps %s %s reachable through both API prefixes",
    async (method, suffix) => {
      for (const prefix of ["/api", "/api/v1"]) {
        const response = await request(app)[method](`${prefix}${suffix}`).send({});
        expect(response.statusCode).not.toBe(404);
      }
    }
  );

  it("keeps health routes unversioned and does not add versioned readiness", async () => {
    const root = await request(app).get("/");
    const live = await request(app).get("/health/live");
    const versionedReady = await request(app).get("/api/v1/ready");

    expect(root.body).toEqual({ message: "Inventory Management API is running" });
    expect(live.body).toEqual({
      status: "ok",
      service: "inventory-management-api",
    });
    expect(root.body.meta).toBeUndefined();
    expect(live.body.meta).toBeUndefined();
    expectV1Error(versionedReady, 404, "RESOURCE_NOT_FOUND");
  });

  it("uses exact v1 success envelopes for single, mutation, and message-only responses", async () => {
    const managerToken = await createManagerToken();
    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("X-Request-ID", "wp7-request")
      .set("X-Correlation-ID", "wp7-correlation")
      .send({ sku: "WP7-CONTRACT", name: "WP7 Contract Product" });

    expect(created.statusCode).toBe(201);
    expect(created.body.data.sku).toBe("WP7-CONTRACT");
    expect(created.body.message).toBeUndefined();
    expect(created.body.meta).toEqual({
      requestId: "wp7-request",
      correlationId: "wp7-correlation",
      schemaVersion: "1.0",
    });
    expect(created.body.data.data).toBeUndefined();

    const single = await request(app)
      .get(`/api/v1/products/${created.body.data._id}`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(single.body).toEqual({
      data: expect.objectContaining({ sku: "WP7-CONTRACT" }),
      meta: expect.objectContaining({ schemaVersion: "1.0" }),
    });

    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: "a".repeat(128) });
    expect(logout.statusCode).toBe(200);
    expect(logout.body.data).toBeNull();
    expect(logout.body.meta.schemaVersion).toBe("1.0");
  });

  it("keeps canonical User and authentication DTOs bounded while retaining tokens", async () => {
    const admin = await createTestUser({ role: "admin" });
    const adminToken = createAccessToken(admin);
    const credentials = {
      name: "Bounded User",
      email: "bounded.user@example.com",
      password: "Password123",
      role: "manager",
    };
    const created = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(credentials);
    expect(created.statusCode).toBe(201);
    expect(Object.keys(created.body.data).sort()).toEqual(
      ["id", "name", "email", "role", "status"].sort()
    );
    expectNoForbiddenFields(created.body);
    expect(JSON.stringify(created.body)).not.toContain("password");
    expect(JSON.stringify(created.body)).not.toContain("tokenHash");

    const login = await request(app).post("/api/v1/auth/login").send({
      email: credentials.email,
      password: credentials.password,
    });
    expect(login.statusCode).toBe(200);
    expect(Object.keys(login.body.data).sort()).toEqual(
      ["accessToken", "refreshToken", "user"].sort()
    );
    expect(login.body.data.accessToken).toEqual(expect.any(String));
    expect(login.body.data.refreshToken).toEqual(expect.any(String));
    expect(Object.keys(login.body.data.user).sort()).toEqual(
      ["id", "name", "email", "role", "status"].sort()
    );
    expectNoForbiddenFields(login.body);
    expect(JSON.stringify(login.body.data.user)).not.toContain("password");
    expect(JSON.stringify(login.body.data.user)).not.toContain("tokenHash");
  });

  it("preserves legacy success shapes while bounding collection results", async () => {
    const token = await createViewerToken();
    await Product.create({ sku: "LEGACY-SHAPE", name: "Legacy Shape" });
    const response = await request(app)
      .get("/api/products?limit=1")
      .set("Authorization", `Bearer ${token}`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: "Products retrieved successfully",
      data: [expect.objectContaining({ sku: "LEGACY-SHAPE" })],
    });
    expect(response.body.meta).toBeUndefined();
  });

  it.each(invalidResourceIdCases)(
    "preserves the exact legacy invalid-ID body for %s",
    async (resource, detail, model) => {
      const token = await createViewerToken();
      const findOne = jest.spyOn(model, "findOne");

      try {
        const response = await request(app)
          .get(`/api/${resource}/not-an-id`)
          .set("Authorization", `Bearer ${token}`);

        expect(response.statusCode).toBe(400);
        expect(response.body).toEqual({ message: detail });
        expect(Object.keys(response.body)).toEqual(["message"]);
        expect(response.body).not.toHaveProperty("errors");
        expect(response.body).not.toHaveProperty("data");
        expect(response.body).not.toHaveProperty("meta");
        expect(findOne).not.toHaveBeenCalled();
      } finally {
        findOne.mockRestore();
      }
    }
  );

  it.each(invalidResourceIdCases)(
    "keeps the exact v1 invalid-ID contract for %s",
    async (resource, detail, model) => {
      const token = await createViewerToken();
      const findOne = jest.spyOn(model, "findOne");
      const rawInvalidId = "not-an-id";

      try {
        const response = await request(app)
          .get(`/api/v1/${resource}/${rawInvalidId}`)
          .set("Authorization", `Bearer ${token}`)
          .set("X-Request-ID", `invalid-${resource}-request`)
          .set("X-Correlation-ID", `invalid-${resource}-correlation`);

        expectV1Error(response, 400, "VALIDATION_FAILED");
        expect(response.body).toEqual({
          type: "inventory-error",
          title: "Validation failed",
          status: 400,
          code: "VALIDATION_FAILED",
          detail,
          requestId: response.headers["x-request-id"],
          correlationId: response.headers["x-correlation-id"],
          retryable: false,
          errors: [],
        });
        expect(JSON.stringify(response.body)).not.toContain(rawInvalidId);
        expect(findOne).not.toHaveBeenCalled();
      } finally {
        findOne.mockRestore();
      }
    }
  );

  it("returns v1 validation, ID, authentication, RBAC, inactive-user, malformed JSON, and 404 errors", async () => {
    const managerToken = await createManagerToken();
    const viewerToken = await createViewerToken();
    const inactive = await createTestUser({ status: "inactive" });

    const validation = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({});
    expectV1Error(validation, 400, "VALIDATION_FAILED");
    expect(validation.body.errors[0]).toEqual({
      field: expect.any(String),
      message: expect.any(String),
    });
    expect(validation.body.errors[0]).not.toHaveProperty("value");

    const invalidId = await request(app)
      .get("/api/v1/products/not-an-id")
      .set("Authorization", `Bearer ${viewerToken}`);
    expectV1Error(invalidId, 400, "VALIDATION_FAILED");

    expectV1Error(
      await request(app).get("/api/v1/products"),
      401,
      "AUTHENTICATION_REQUIRED"
    );
    expectV1Error(
      await request(app)
        .get("/api/v1/products")
        .set("Authorization", "Bearer invalid-token"),
      401,
      "INVALID_ACCESS_TOKEN"
    );
    expectV1Error(
      await request(app)
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ sku: "DENIED", name: "Denied" }),
      403,
      "ACCESS_DENIED"
    );
    expectV1Error(
      await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${createAccessToken(inactive)}`),
      403,
      "ACCESS_DENIED"
    );

    const malformed = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":');
    expectV1Error(malformed, 400, "VALIDATION_FAILED");
    expect(malformed.body.detail).toBe("Malformed JSON request body");

    expectV1Error(
      await request(app).get("/api/v1/does-not-exist"),
      404,
      "RESOURCE_NOT_FOUND"
    );
  });

  it("maps DomainError and internal failures without exposing internal details", async () => {
    const managerToken = await createManagerToken();
    await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ sku: "DUPLICATE-WP7", name: "First" });
    const duplicate = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ sku: "DUPLICATE-WP7", name: "Second" });
    expectV1Error(duplicate, 409, "DUPLICATE_RESOURCE");

    const privateMarker = "mongodb://user:password@private/database";
    const req = {
      apiContractVersion: "v1",
      applicationContext: {
        requestId: "internal-request",
        correlationId: "internal-correlation",
      },
    };
    const res = {
      locals: {},
      statusCode: 200,
      status: jest.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn(function json(body) {
        this.body = body;
        return this;
      }),
    };
    createErrorHandler({ log: jest.fn() })(
      new Error(privateMarker),
      req,
      res,
      jest.fn()
    );
    expect(res.body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain(privateMarker);
    expect(res.body.detail).toBe("An unexpected error occurred");
  });

  it("uses the v1 envelope for login rate limiting", async () => {
    const email = "wp7.rate.limit@example.com";
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password: "Password123" });
    }
    expectV1Error(response, 429, "RATE_LIMITED");
  });

  it.each([
    ["/api/goods-receipts", "/api/v1/goods-receipts"],
    ["/api/v1/goods-receipts", "/api/goods-receipts"],
  ])(
    "replays one contract-neutral mutation from %s through %s",
    async (firstPath, replayPath) => {
      const managerToken = await createManagerToken();
      const [product, warehouse] = await Promise.all([
        Product.create({ sku: `IDEMP-${firstPath.length}`, name: "Idempotent" }),
        Warehouse.create({ code: `IDEMP-${replayPath.length}`, name: "Idempotent" }),
      ]);
      const stock = await Stock.create({
        productId: product._id,
        warehouseId: warehouse._id,
      });
      const key = `wp7-cross-version-${firstPath.length}-${replayPath.length}`;
      const payload = { stockId: stock._id.toString(), quantity: 3 };

      const first = await request(app)
        .post(firstPath)
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", key)
        .send(payload);
      const replay = await request(app)
        .post(replayPath)
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", key)
        .send(payload);

      expect(first.statusCode).toBe(201);
      expect(replay.statusCode).toBe(201);
      expect(first.headers["idempotency-replayed"]).toBe("false");
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      const legacy = firstPath === "/api/goods-receipts" ? first : replay;
      const v1 = firstPath.startsWith("/api/v1") ? first : replay;
      expect(legacy.body.message).toBe("Goods receipt completed successfully");
      expect(legacy.body.meta).toBeUndefined();
      expect(v1.body.message).toBeUndefined();
      expect(v1.body.meta.schemaVersion).toBe("1.0");
      expectOnlyKeys(v1.body.data, ["stock", "stockMovement"], [
        "stock",
        "stockMovement",
      ]);
      expectV1Resource(v1.body.data.stock, "Stock");
      expectV1Resource(v1.body.data.stockMovement, "StockMovement");
      expectNoForbiddenFields(v1.body);
      expect(await StockMovement.countDocuments()).toBe(1);
      expect(await AuditEvent.countDocuments()).toBe(1);
      expect(await OutboxEvent.countDocuments()).toBe(1);
      expect((await Stock.findById(stock._id)).quantity).toBe(3);

      const conflict = await request(app)
        .post(replayPath)
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", key)
        .send({ ...payload, quantity: 4 });
      expect(conflict.statusCode).toBe(409);
    }
  );

  it.each([
    ["/api/products", "/api/v1/products"],
    ["/api/v1/products", "/api/products"],
  ])(
    "replays one single-resource mutation from %s through %s",
    async (firstPath, replayPath) => {
      const managerToken = await createManagerToken();
      const key = `wp7-product-cross-version-${firstPath.length}`;
      const payload = {
        sku: `CROSS-VERSION-${firstPath.length}`,
        name: "Cross-version Product",
      };

      const first = await request(app)
        .post(firstPath)
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", key)
        .send(payload);
      const replay = await request(app)
        .post(replayPath)
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", key)
        .send(payload);

      expect(first.statusCode).toBe(201);
      expect(replay.statusCode).toBe(201);
      expect(first.headers["idempotency-replayed"]).toBe("false");
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      const legacy = firstPath === "/api/products" ? first : replay;
      const v1 = firstPath === "/api/v1/products" ? first : replay;
      expect(legacy.body.message).toBe("Product created successfully");
      expect(legacy.body.meta).toBeUndefined();
      expect(v1.body.message).toBeUndefined();
      expect(v1.body.meta.schemaVersion).toBe("1.0");
      expectV1Resource(v1.body.data, "Product");
      expect(v1.body.data.version).toBe(1);
      expect(await Product.countDocuments({ sku: payload.sku })).toBe(1);
      expect(await AuditEvent.countDocuments()).toBe(1);
      expect(await OutboxEvent.countDocuments()).toBe(1);
      expect(await StockMovement.countDocuments()).toBe(0);
    }
  );
});
