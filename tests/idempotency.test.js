const request = require("supertest");

const app = require("../src/app");
const IdempotencyRecord = require("../src/models/IdempotencyRecord");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const User = require("../src/models/User");
const Warehouse = require("../src/models/Warehouse");
const {
  createAccessToken,
  createManagerToken,
  createTestUser,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const KEY = "test.idempotency:0001";

const createInventoryFixture = async (quantity = 0) => {
  const product = await Product.create({
    sku: `IDEM-P-${new Date().getTime()}-${Math.random()}`.replace(".", "-"),
    name: "Idempotency product",
  });
  const warehouse = await Warehouse.create({
    code: `IDEM-W-${new Date().getTime()}-${Math.random()}`.replace(".", "-"),
    name: "Idempotency warehouse",
  });
  const stock = await Stock.create({
    productId: product._id,
    warehouseId: warehouse._id,
    quantity,
  });
  return { product, warehouse, stock };
};

describe("Inventory Core idempotency", () => {
  beforeEach(async () => {
    await IdempotencyRecord.createIndexes();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("stores a hashed completed Product create response and replays it exactly", async () => {
    const token = await createManagerToken();
    const payload = { sku: "IDEM-PRODUCT-001", name: "Idempotent product" };

    const original = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", KEY)
      .send(payload);
    const replay = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", KEY)
      .set("X-Correlation-ID", "replay-correlation")
      .send({ name: "Idempotent product", sku: "IDEM-PRODUCT-001" });

    expect(original.status).toBe(201);
    expect(original.headers["idempotency-replayed"]).toBe("false");
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body).toEqual(original.body);
    expect(replay.headers["x-request-id"]).not.toBe(
      original.headers["x-request-id"]
    );
    expect(replay.headers["x-correlation-id"]).toBe("replay-correlation");
    expect(await Product.countDocuments({ sku: payload.sku })).toBe(1);

    const records = await IdempotencyRecord.find({}).lean();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actorType: "user",
      operationId: "catalog.product.create.v1",
      keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestHashVersion: "canonical-json-v1",
      state: "completed",
      statusCode: 201,
      responseBody: original.body,
      source: "http-api",
    });
    expect(records[0].keyHash).not.toContain(KEY);
    expect(JSON.stringify(records[0])).not.toContain(KEY);
    expect(records[0]).not.toHaveProperty("email");
    expect(records[0]).not.toHaveProperty("name");
    expect(records[0]).not.toHaveProperty("role");
    expect(records[0].expiresAt.getTime() - records[0].completedAt.getTime()).toBe(
      IdempotencyRecord.IDEMPOTENCY_RETENTION_MS
    );
  });

  it("returns 409 for the same scope with a different normalized command", async () => {
    const token = await createManagerToken();
    const original = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", KEY)
      .send({ sku: "IDEM-CONFLICT-1", name: "Original" });
    const conflict = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", KEY)
      .send({ sku: "IDEM-CONFLICT-2", name: "Different" });

    expect(original.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({
      message: "Idempotency key was already used with a different request",
    });
    expect(await Product.countDocuments()).toBe(1);
    expect(await IdempotencyRecord.countDocuments()).toBe(1);
  });

  it("does not misclassify a domain Product SKU duplicate as an idempotency replay", async () => {
    const token = await createManagerToken();
    const payload = { sku: "IDEM-DOMAIN-DUP", name: "Domain duplicate" };
    const first = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "domain.duplicate:key-1")
      .send(payload);
    const duplicate = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "domain.duplicate:key-2")
      .send(payload);

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({
      message: "A product with this SKU already exists",
    });
    expect(duplicate.headers["idempotency-replayed"]).toBeUndefined();
    expect(await IdempotencyRecord.countDocuments()).toBe(1);
  });

  it("hashes normalized path parameters and rejects same-key use on another target", async () => {
    const token = await createManagerToken();
    const [firstProduct, secondProduct] = await Product.create([
      { sku: "IDEM-PATH-1", name: "First" },
      { sku: "IDEM-PATH-2", name: "Second" },
    ]);
    const first = await request(app)
      .patch(`/api/products/${firstProduct._id}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "path.target:conflict")
      .send({ name: "Changed", expectedVersion: firstProduct.version });
    const conflict = await request(app)
      .patch(`/api/products/${secondProduct._id}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "path.target:conflict")
      .send({ name: "Changed", expectedVersion: secondProduct.version });

    expect(first.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect((await Product.findById(firstProduct._id)).version).toBe(2);
    expect((await Product.findById(secondProduct._id)).version).toBe(1);
  });

  it("does not create records for invalid keys, auth failures, RBAC failures, validation failures, or GET", async () => {
    const managerToken = await createManagerToken();
    const viewerToken = await createViewerToken();
    const responses = [
      await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", "short")
        .send({ sku: "NO-KEY-1", name: "Invalid key" }),
      await request(app)
        .post("/api/products")
        .set("Idempotency-Key", KEY)
        .send({ sku: "NO-AUTH-1", name: "No auth" }),
      await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${viewerToken}`)
        .set("Idempotency-Key", KEY)
        .send({ sku: "NO-RBAC-1", name: "No RBAC" }),
      await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", KEY)
        .send({ sku: "bad sku", name: "Invalid body" }),
      await request(app)
        .get("/api/products")
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", KEY),
    ];

    expect(responses.map(({ status }) => status)).toEqual([400, 401, 403, 400, 200]);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
    expect(await Product.countDocuments()).toBe(0);
  });

  it("requires current authorization before replay", async () => {
    const managerToken = await createManagerToken();
    const viewerToken = await createViewerToken();
    const payload = { sku: "IDEM-AUTH-1", name: "Auth replay" };
    expect(
      (
        await request(app)
          .post("/api/products")
          .set("Authorization", `Bearer ${managerToken}`)
          .set("Idempotency-Key", KEY)
          .send(payload)
      ).status
    ).toBe(201);

    const denied = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${viewerToken}`)
      .set("Idempotency-Key", KEY)
      .send(payload);
    expect(denied.status).toBe(403);
    expect(denied.headers["idempotency-replayed"]).toBeUndefined();
    expect(await IdempotencyRecord.countDocuments()).toBe(1);
  });

  it("denies replay after the same actor is downgraded from manager to viewer", async () => {
    const manager = await createTestUser({ role: "manager" });
    const token = createAccessToken(manager);
    const payload = { sku: "IDEM-SAME-ACTOR-ROLE", name: "Role revoked" };

    const original = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "same.actor.role-change")
      .send(payload);
    const recordBefore = await IdempotencyRecord.findOne({
      actorId: manager._id.toString(),
      operationId: "catalog.product.create.v1",
    }).lean();
    const productBefore = await Product.findOne({ sku: payload.sku }).lean();

    expect(original.status).toBe(201);
    expect(recordBefore).toMatchObject({
      state: "completed",
      responseBody: original.body,
    });
    expect(await IdempotencyRecord.countDocuments()).toBe(1);

    await User.updateOne({ _id: manager._id }, { $set: { role: "viewer" } });

    const denied = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "same.actor.role-change")
      .send(payload);
    const recordAfter = await IdempotencyRecord.findById(recordBefore._id).lean();

    expect(denied.status).toBe(403);
    expect(denied.headers["idempotency-replayed"]).toBeUndefined();
    expect(await Product.findOne({ sku: payload.sku }).lean()).toEqual(
      productBefore
    );
    expect(recordAfter.responseBody).toEqual(recordBefore.responseBody);
    expect(recordAfter.completedAt).toEqual(recordBefore.completedAt);
    expect(recordAfter.expiresAt).toEqual(recordBefore.expiresAt);
    expect(recordAfter).toEqual(recordBefore);
    expect(await IdempotencyRecord.countDocuments()).toBe(1);
  });

  it("denies replay after the same actor becomes inactive", async () => {
    const manager = await createTestUser({ role: "manager", status: "active" });
    const token = createAccessToken(manager);
    const payload = { sku: "IDEM-SAME-ACTOR-STATUS", name: "Status revoked" };

    const original = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "same.actor.inactive")
      .send(payload);
    const recordBefore = await IdempotencyRecord.findOne({
      actorId: manager._id.toString(),
      operationId: "catalog.product.create.v1",
    }).lean();
    const productBefore = await Product.findOne({ sku: payload.sku }).lean();

    expect(original.status).toBe(201);
    expect(recordBefore).toMatchObject({
      state: "completed",
      responseBody: original.body,
    });
    expect(await IdempotencyRecord.countDocuments()).toBe(1);

    await User.updateOne({ _id: manager._id }, { $set: { status: "inactive" } });

    const denied = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "same.actor.inactive")
      .send(payload);
    const recordAfter = await IdempotencyRecord.findById(recordBefore._id).lean();

    expect(denied.status).toBe(403);
    expect(denied.headers["idempotency-replayed"]).toBeUndefined();
    expect(await Product.findOne({ sku: payload.sku }).lean()).toEqual(
      productBefore
    );
    expect(recordAfter.responseBody).toEqual(recordBefore.responseBody);
    expect(recordAfter.completedAt).toEqual(recordBefore.completedAt);
    expect(recordAfter.expiresAt).toEqual(recordBefore.expiresAt);
    expect(recordAfter).toEqual(recordBefore);
    expect(await IdempotencyRecord.countDocuments()).toBe(1);
  });

  it("scopes the same key independently by actor and operation", async () => {
    const firstToken = await createManagerToken();
    const secondToken = await createManagerToken();

    const first = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${firstToken}`)
      .set("Idempotency-Key", KEY)
      .send({ sku: "IDEM-ACTOR-1", name: "Actor one" });
    const second = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${secondToken}`)
      .set("Idempotency-Key", KEY)
      .send({ sku: "IDEM-ACTOR-2", name: "Actor two" });
    const otherOperation = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${firstToken}`)
      .set("Idempotency-Key", KEY)
      .send({ code: "IDEM-OP-1", name: "Other operation" });

    expect([first.status, second.status, otherOperation.status]).toEqual([
      201, 201, 201,
    ]);
    expect(await IdempotencyRecord.countDocuments()).toBe(3);
  });

  it("executes ten concurrent identical receipts once", async () => {
    const token = await createManagerToken();
    const { stock } = await createInventoryFixture();
    const payload = { stockId: stock._id.toString(), quantity: 5, reference: "PO-5" };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post("/api/goods-receipts")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", "concurrent.receipt:0001")
          .send(payload)
      )
    );

    expect(new Set(responses.map(({ status }) => status))).toEqual(new Set([201]));
    expect(responses.filter((response) => response.headers["idempotency-replayed"] === "false")).toHaveLength(1);
    expect(responses.filter((response) => response.headers["idempotency-replayed"] === "true")).toHaveLength(9);
    expect(responses.every((response) => JSON.stringify(response.body) === JSON.stringify(responses[0].body))).toBe(true);
    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(1);
    expect(await IdempotencyRecord.countDocuments()).toBe(1);
  });

  it("allows at most one commit for concurrent same-key different-payload requests", async () => {
    const token = await createManagerToken();
    const responses = await Promise.all([
      request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "concurrent.different:0001")
        .send({ sku: "IDEM-RACE-A", name: "Race A" }),
      request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "concurrent.different:0001")
        .send({ sku: "IDEM-RACE-B", name: "Race B" }),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(await Product.countDocuments()).toBe(1);
    expect(await IdempotencyRecord.countDocuments({ state: "completed" })).toBe(1);
  });

  it("replays semantically equal normalized numeric and trimmed input", async () => {
    const token = await createManagerToken();
    const { stock } = await createInventoryFixture();
    const original = await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "normalized.receipt:0001")
      .send({ stockId: stock._id.toString().toUpperCase(), quantity: "5", reference: "  PO-5  " });
    const replay = await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "normalized.receipt:0001")
      .send({ stockId: stock._id.toString(), quantity: 5, reference: "PO-5" });

    expect(original.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body).toEqual(original.body);
    expect((await Stock.findById(stock._id)).quantity).toBe(5);
  });

  it("does not reserve a key after insufficient stock and permits a later retry", async () => {
    const token = await createManagerToken();
    const { stock } = await createInventoryFixture(1);
    const payload = { stockId: stock._id.toString(), quantity: 2 };

    const failed = await request(app)
      .post("/api/goods-issues")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "retry.issue.after-stock")
      .send(payload);
    expect(failed.status).toBe(409);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);

    await Stock.updateOne({ _id: stock._id }, { $set: { quantity: 3 } });
    const succeeded = await request(app)
      .post("/api/goods-issues")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "retry.issue.after-stock")
      .send(payload);
    expect(succeeded.status).toBe(201);
    expect(await IdempotencyRecord.countDocuments({ state: "completed" })).toBe(1);
    expect(await IdempotencyRecord.countDocuments({ state: "processing" })).toBe(0);
  });

  it("rolls back Stock and idempotency acquisition when movement persistence fails", async () => {
    const token = await createManagerToken();
    const { stock } = await createInventoryFixture();
    jest.spyOn(StockMovement, "create").mockRejectedValue(
      new Error("Injected movement persistence failure")
    );

    const response = await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "movement.failure:0001")
      .send({ stockId: stock._id.toString(), quantity: 5 });

    expect(response.status).toBe(500);
    expect((await Stock.findById(stock._id)).quantity).toBe(0);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
  });
});
