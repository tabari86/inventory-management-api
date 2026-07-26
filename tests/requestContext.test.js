const request = require("supertest");

const app = require("../src/app");
const Product = require("../src/models/Product");
const productService = require("../src/services/productService");
const {
  isValidCorrelationId,
} = require("../src/middleware/requestContext");
const {
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const expectContextHeaders = (response) => {
  expect(response.headers["x-request-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  expect(response.headers["x-correlation-id"]).toBeDefined();
};

describe("request context", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("generates a fresh server request ID and defaults correlation to it", async () => {
    const first = await request(app)
      .get("/health")
      .set("X-Request-ID", "client-controlled-request-id");
    const second = await request(app).get("/health");

    expectContextHeaders(first);
    expect(first.headers["x-request-id"]).not.toBe(
      "client-controlled-request-id"
    );
    expect(first.headers["x-correlation-id"]).toBe(
      first.headers["x-request-id"]
    );
    expect(second.headers["x-request-id"]).not.toBe(
      first.headers["x-request-id"]
    );
  });

  it("accepts a valid correlation ID and passes plain context with auth actor", async () => {
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
      .set("X-Correlation-ID", "order:2026-07-26.001")
      .send({ sku: "CTX-001", name: "Context product" });

    expect(response.status).toBe(201);
    expect(response.headers["x-correlation-id"]).toBe("order:2026-07-26.001");
    expect(observedContext).toEqual({
      requestId: response.headers["x-request-id"],
      correlationId: "order:2026-07-26.001",
      source: "http-api",
      actor: {
        type: "user",
        id: expect.any(String),
      },
    });
    expect(observedContext).not.toHaveProperty("email");
    expect(observedContext).not.toHaveProperty("role");
  });

  it.each([
    "contains whitespace",
    "comma,value",
    "",
    "a".repeat(129),
  ])("rejects invalid correlation value %j before mutation", async (value) => {
    const response = await request(app)
      .post("/api/products")
      .set("X-Correlation-ID", value)
      .send({ sku: "CTX-BLOCKED", name: "Blocked" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Invalid X-Correlation-ID header" });
    expectContextHeaders(response);
    expect(await Product.countDocuments()).toBe(0);
  });

  it("rejects multiple and control-style correlation values at the validator boundary", () => {
    expect(
      isValidCorrelationId({
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
        isValidCorrelationId({
          present: true,
          validCardinality: true,
          value,
        })
      ).toBe(false);
    }
  });

  it("sets context headers on auth, RBAC, validation, domain, and unmatched paths", async () => {
    const managerToken = await createManagerToken();
    const viewerToken = await createViewerToken();
    const responses = [
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
        .send({ name: "Missing" }),
      await request(app).get("/not-a-route"),
    ];

    expect(responses.map(({ status }) => status)).toEqual([401, 403, 400, 404, 404]);
    responses.forEach(expectContextHeaders);
  });
});
