const mongoose = require("mongoose");

const IdempotencyRecord = require("../src/models/IdempotencyRecord");
const AuditEvent = require("../src/models/AuditEvent");
const OutboxEvent = require("../src/models/OutboxEvent");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const {
  executeInventoryMutation,
  serializeResponse,
} = require("../src/services/idempotencyExecutor");
const { buildCanonicalCommand, hashCanonicalCommand } = require("../src/utils/canonicalJson");
const { hashIdempotencyKey } = require("../src/utils/idempotencyHash");
const { buildProductSnapshot } = require("../src/services/eventSnapshots");
const {
  createDomainEventCollector,
} = require("../src/services/domainEventCollector");
const {
  persistAuditOutboxEvents,
} = require("../src/services/auditOutboxService");
const inventoryService = require("../src/services/inventoryService");

require("./setupTestDb");

const context = {
  requestId: "018f71c3-6aea-48e1-9e0f-098c0306d9ad",
  correlationId: "executor-test",
  causationId: "018f71c3-6aea-48e1-9e0f-098c0306d9ad",
  source: "http-api",
  actor: {
    type: "user",
    id: "64b64c6f2f0f000000000001",
  },
};

const operationId = "catalog.product.create.v1";
const command = buildCanonicalCommand({
  operationId,
  normalizedBody: { sku: "EXEC-001", name: "Executor product" },
});

const executeProduct = async ({ session, eventCollector }) => {
  const [product] = await Product.create(
    [{ sku: "EXEC-001", name: "Executor product" }],
    { session }
  );
  eventCollector.recordChange({
    eventType: "catalog.product.created",
    aggregateType: "Product",
    aggregateId: product._id.toString(),
    aggregateVersion: product.version,
    before: null,
    after: buildProductSnapshot(product),
    payload: {
      productId: product._id.toString(),
      sku: product.sku,
      status: product.status,
      aggregateVersion: product.version,
    },
  });
  return product;
};

const execute = (overrides = {}) =>
  executeInventoryMutation({
    context,
    inventoryOperation: {
      operationId,
      keyHash: hashIdempotencyKey("executor.test-key"),
    },
    command,
    statusCode: 201,
    execute: executeProduct,
    buildResponse: (product) => ({ message: "created", data: product }),
    ...overrides,
  });

describe("idempotency executor failure and storage boundaries", () => {
  beforeEach(async () => {
    await IdempotencyRecord.createIndexes();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts a UTF-8 response exactly at the configured byte limit", () => {
    const emptySize = Buffer.byteLength(JSON.stringify({ payload: "" }), "utf8");
    const limit = 256;
    const body = { payload: "x".repeat(limit - emptySize) };

    expect(serializeResponse(body, limit)).toEqual({
      responseBody: body,
      responseSizeBytes: limit,
    });
  });

  it("declares exact model indexes and rejects processing outside a transaction", async () => {
    expect(IdempotencyRecord.schema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { actorType: 1, actorId: 1, operationId: 1, keyHash: 1 },
          { unique: true, name: "uq_idempotency_scope" },
        ],
        [
          { expiresAt: 1 },
          {
            expireAfterSeconds: 0,
            name: "ttl_idempotency_expires_at",
          },
        ],
      ])
    );

    const { requestHash, requestHashVersion } = hashCanonicalCommand(command);
    await expect(
      IdempotencyRecord.create({
        actorType: context.actor.type,
        actorId: context.actor.id,
        operationId,
        keyHash: hashIdempotencyKey("outside.transaction"),
        requestHash,
        requestHashVersion,
        state: "processing",
        originalRequestId: context.requestId,
        originalCorrelationId: context.correlationId,
        source: context.source,
      })
    ).rejects.toThrow("Processing idempotency records must remain transaction-internal");
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
  });

  it("rejects an over-limit response and rolls back the domain write and acquisition", async () => {
    await expect(
      execute({
        buildResponse: () => ({ payload: "é".repeat(40) }),
        dependencies: { responseLimitBytes: 32 },
      })
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_RESPONSE_TOO_LARGE",
      httpStatus: 500,
      safeMessage: "Response is too large for idempotent replay",
    });

    expect(await Product.countDocuments()).toBe(0);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  it("rejects circular response serialization and rolls back all writes", async () => {
    const circular = {};
    circular.self = circular;

    await expect(
      execute({ buildResponse: () => circular })
    ).rejects.toMatchObject({
      code: "TRANSACTION_FAILED",
      httpStatus: 500,
      safeMessage: "Could not complete request",
    });
    expect(await Product.countDocuments()).toBe(0);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  it("rolls back the domain write when record completion fails", async () => {
    const originalSave = IdempotencyRecord.prototype.save;
    jest
      .spyOn(IdempotencyRecord.prototype, "save")
      .mockImplementation(function saveWithInjectedCompletionFailure(...args) {
        if (this.state === "completed") {
          throw new Error("Injected completion failure");
        }
        return originalSave.apply(this, args);
      });

    await expect(execute()).rejects.toThrow("Injected completion failure");
    expect(await Product.countDocuments()).toBe(0);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  it("recreates collectors and event IDs after a persisted transient attempt aborts", async () => {
    const product = await Product.create({ sku: "EXEC-RETRY", name: "Retry" });
    const warehouse = await Warehouse.create({ code: "EXEC-RETRY-W", name: "Retry" });
    const stock = await Stock.create({
      productId: product._id,
      warehouseId: warehouse._id,
      quantity: 0,
    });
    const retryOperationId = "inventory.goods-receipt.single.v1";
    const retryCommand = buildCanonicalCommand({
      operationId: retryOperationId,
      normalizedBody: {
        stockId: stock._id.toString(),
        quantity: 4,
        reference: "RETRY-RECEIPT",
      },
    });
    const collectors = [];
    const persistedAttempts = [];
    let completionAttempts = 0;

    const outcome = await executeInventoryMutation({
      context,
      inventoryOperation: {
        operationId: retryOperationId,
        keyHash: hashIdempotencyKey("executor.retry-key"),
      },
      command: retryCommand,
      statusCode: 201,
      execute: ({ session, eventCollector }) =>
        inventoryService.createGoodsReceipt({
          stockId: stock._id.toString(),
          quantity: 4,
          reference: "RETRY-RECEIPT",
          session,
          eventCollector,
        }),
      buildResponse: (data) => ({ message: "received", data }),
      dependencies: {
        eventCollectorFactory: () => {
          const collector = createDomainEventCollector();
          collectors.push(collector);
          return collector;
        },
        eventPersistence: async (args) => {
          const persisted = await persistAuditOutboxEvents(args);
          persistedAttempts.push(persisted);
          return persisted;
        },
        now: () => {
          completionAttempts += 1;
          if (completionAttempts === 1) {
            const transient = new mongoose.mongo.MongoServerError({
              message: "Injected transient transaction error",
              code: 251,
            });
            transient.addErrorLabel("TransientTransactionError");
            throw transient;
          }
          return new Date("2026-07-27T12:00:00.000Z");
        },
      },
    });

    expect(outcome.statusCode).toBe(201);
    expect(outcome.body.message).toBe("received");
    expect(completionAttempts).toBe(2);
    expect(collectors).toHaveLength(2);
    expect(collectors[0]).not.toBe(collectors[1]);
    expect(collectors.map((collector) => collector.descriptors().length)).toEqual([
      1,
      1,
    ]);
    expect(persistedAttempts).toHaveLength(2);
    expect(persistedAttempts[0].auditEventIds).not.toEqual(
      persistedAttempts[1].auditEventIds
    );
    expect(persistedAttempts[0].outboxEventIds).not.toEqual(
      persistedAttempts[1].outboxEventIds
    );
    expect(
      await AuditEvent.countDocuments({
        auditEventId: { $in: persistedAttempts[0].auditEventIds },
      })
    ).toBe(0);
    expect(
      await OutboxEvent.countDocuments({
        eventId: { $in: persistedAttempts[0].outboxEventIds },
      })
    ).toBe(0);
    expect(await Product.countDocuments()).toBe(1);
    expect(await StockMovement.countDocuments()).toBe(1);
    expect(await Stock.findById(stock._id).lean()).toMatchObject({
      quantity: 4,
      version: 2,
    });
    expect(await IdempotencyRecord.countDocuments({ state: "completed" })).toBe(1);
    expect(await AuditEvent.countDocuments()).toBe(1);
    expect(await OutboxEvent.countDocuments()).toBe(1);
  });

  it("stores an immutable plain response snapshot rather than a live document", async () => {
    const outcome = await execute();
    outcome.body.data.name = "Changed only in caller memory";

    const stored = await IdempotencyRecord.findOne({}).lean();
    expect(stored.responseBody.data.name).toBe("Executor product");
    expect(stored.responseBody.data.constructor).toBe(Object);
    expect(stored.responseSizeBytes).toBe(
      Buffer.byteLength(JSON.stringify(stored.responseBody), "utf8")
    );
  });

  it("resolves a committed scope in no more than three attempts", async () => {
    const { requestHash, requestHashVersion } = hashCanonicalCommand(command);
    await IdempotencyRecord.collection.insertOne({
      actorType: context.actor.type,
      actorId: context.actor.id,
      operationId,
      keyHash: hashIdempotencyKey("executor.test-key"),
      requestHash,
      requestHashVersion,
      state: "processing",
      originalRequestId: context.requestId,
      originalCorrelationId: context.correlationId,
      source: context.source,
    });
    const backoff = jest.fn().mockResolvedValue(undefined);

    await expect(
      execute({ dependencies: { backoff } })
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_IN_PROGRESS",
      httpStatus: 409,
      retryable: true,
    });
    expect(backoff).toHaveBeenCalledTimes(2);
    expect(await Product.countDocuments()).toBe(0);
  });
});
