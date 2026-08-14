const request = require("supertest");

const app = require("../src/app");
const { createApp } = require("../src/app");
const AuditEvent = require("../src/models/AuditEvent");
const OutboxEvent = require("../src/models/OutboxEvent");
const Product = require("../src/models/Product");
const productService = require("../src/services/productService");
const {
  isValidContextId,
} = require("../src/middleware/requestContext");
const {
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const expectContextHeaders = (response) => {
  expect(response.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
  expect(response.headers["x-correlation-id"]).toMatch(
    /^[A-Za-z0-9._:-]{1,128}$/
  );
};

describe("request context", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("preserves a valid request ID and safely generates a missing context", async () => {
    const inboundRequestId = "request:2026-07-27.001";
    const preserved = await request(app)
      .get("/health/live")
      .set("X-Request-ID", inboundRequestId);
    const generated = await request(app).get("/health");

    expect(preserved.headers["x-request-id"]).toBe(inboundRequestId);
    expect(preserved.headers["x-correlation-id"]).toBe(inboundRequestId);
    expect(generated.headers["x-request-id"]).toMatch(UUID_PATTERN);
    expect(generated.headers["x-correlation-id"]).toBe(
      generated.headers["x-request-id"]
    );
    expect(generated.headers["x-request-id"]).not.toBe(inboundRequestId);
  });

  it("replaces an invalid request ID without reflecting it", async () => {
    const invalidRequestId = "r".repeat(129);
    const response = await request(app)
      .get("/health/live")
      .set("X-Request-ID", invalidRequestId);

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toMatch(UUID_PATTERN);
    expect(response.headers["x-request-id"]).not.toBe(invalidRequestId);
    expect(response.headers["x-correlation-id"]).toBe(
      response.headers["x-request-id"]
    );
  });

  it("accepts valid IDs and preserves Audit/Outbox causation with the auth actor", async () => {
    const token = await createManagerToken();
    const original = productService.createProduct;
    let observedContext;
    jest.spyOn(productService, "createProduct").mockImplementation((args) => {
      observedContext = args.context;
      return original(args);
    });

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Request-ID", "request:product-create.001")
      .set("X-Correlation-ID", "order:2026-07-26.001")
      .send({ sku: "CTX-001", name: "Context product" });

    expect(response.status).toBe(201);
    expect(response.headers["x-request-id"]).toBe("request:product-create.001");
    expect(response.headers["x-correlation-id"]).toBe("order:2026-07-26.001");
    expect(observedContext).toEqual({
      requestId: "request:product-create.001",
      correlationId: "order:2026-07-26.001",
      causationId: "request:product-create.001",
      source: "http-api",
      actor: {
        type: "user",
        id: expect.any(String),
      },
    });
    expect(observedContext).not.toHaveProperty("email");
    expect(observedContext).not.toHaveProperty("role");

    const audit = await AuditEvent.findOne().lean();
    const outbox = await OutboxEvent.findOne().lean();
    for (const event of [audit, outbox]) {
      expect(event.requestId).toBe("request:product-create.001");
      expect(event.correlationId).toBe("order:2026-07-26.001");
      expect(event.causationId).toBe("request:product-create.001");
    }
  });

  it("preserves request context on a successful version-bearing mutation", async () => {
    const token = await createManagerToken();
    const product = await Product.create({
      sku: "CTX-VERSION-001",
      name: "Before",
    });

    const response = await request(app)
      .patch(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Request-ID", "request:product-update.001")
      .set("X-Correlation-ID", "order:product-update.001")
      .send({ name: "After", expectedVersion: product.version });

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe("request:product-update.001");
    expect(response.headers["x-correlation-id"]).toBe(
      "order:product-update.001"
    );
    for (const event of [
      await AuditEvent.findOne().lean(),
      await OutboxEvent.findOne().lean(),
    ]) {
      expect(event).toMatchObject({
        requestId: "request:product-update.001",
        correlationId: "order:product-update.001",
        causationId: "request:product-update.001",
      });
    }
  });

  it.each([
    "contains whitespace",
    "comma,value",
    "",
    "a".repeat(129),
  ])("replaces invalid correlation value %j with a safe fallback", async (value) => {
    const token = await createManagerToken();
    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Correlation-ID", value)
      .send({ sku: "CTX-BLOCKED", name: "Blocked" });

    expect(response.status).toBe(201);
    expectContextHeaders(response);
    expect(response.headers["x-request-id"]).toMatch(UUID_PATTERN);
    expect(response.headers["x-correlation-id"]).toBe(
      response.headers["x-request-id"]
    );
    expect(response.headers["x-correlation-id"]).not.toBe(value);
    expect(await Product.countDocuments()).toBe(1);
  });

  it("rejects multiple and control-style context values at the validator boundary", () => {
    expect(
      isValidContextId({
        present: true,
        validCardinality: false,
        value: "one",
      })
    ).toBe(false);
    for (const value of [
      "line\rbreak",
      "line\nbreak",
      "control\u0001",
      "unicode-☃",
      "",
    ]) {
      expect(
        isValidContextId({
          present: true,
          validCardinality: true,
          value,
        })
      ).toBe(false);
    }
  });

  it("sets context headers on health, auth, RBAC, validation, domain, and unmatched paths", async () => {
    const managerToken = await createManagerToken();
    const viewerToken = await createViewerToken();
    const responses = [
      await request(app).get("/health/live"),
      await request(app).get("/health/ready"),
      await request(app).get("/api/products"),
      await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ sku: "CTX-RBAC", name: "Denied" }),
      await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ sku: "bad sku", name: "Invalid" }),
      await request(app)
        .patch("/api/products/64B64C6F2F0F000000000001")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ name: "Missing", expectedVersion: 1 }),
      await request(app).get("/not-a-route"),
    ];

    expect(responses.map(({ status }) => status)).toEqual([
      200, 503, 401, 403, 400, 404, 404,
    ]);
    responses.forEach(expectContextHeaders);
  });

  it("exposes only authenticated actor type and ID to request logging", async () => {
    const token = await createViewerToken();
    const logger = { log: jest.fn() };
    const loggedApp = createApp({ logger });

    const response = await request(loggedApp)
      .get("/api/products")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(logger.log).toHaveBeenCalledTimes(1);
    const [event, fields] = logger.log.mock.calls[0];
    expect(event).toBe("http_request_completed");
    expect(fields.actor).toEqual({ type: "user", id: expect.any(String) });
    expect(fields.actor).not.toHaveProperty("email");
    expect(fields.actor).not.toHaveProperty("name");
    expect(fields.actor).not.toHaveProperty("role");
  });
});
