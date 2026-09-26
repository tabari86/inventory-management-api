const request = require("supertest");
const { randomUUID } = require("crypto");

const app = require("../src/app");
const { createApp } = app;
const { createLogger } = require("../src/config/logger");
const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const AuditEvent = require("../src/models/AuditEvent");
const IdempotencyRecord = require("../src/models/IdempotencyRecord");
const OutboxEvent = require("../src/models/OutboxEvent");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const User = require("../src/models/User");
const Warehouse = require("../src/models/Warehouse");
const {
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");
const {
  executeInventoryMutation,
} = require("../src/services/idempotencyExecutor");
const { buildCanonicalCommand } = require("../src/utils/canonicalJson");
const { canonicalize } = require("../src/utils/canonicalJson");
const { buildProductSnapshot } = require("../src/services/eventSnapshots");
const {
  persistAuditOutboxEvents,
} = require("../src/services/auditOutboxService");
const { getEventDefinition } = require("../src/services/domainEventRegistry");

require("./setupTestDb");

const createLogCapture = () => {
  const output = [];
  return {
    output,
    destination: {
      write(chunk) {
        output.push(String(chunk));
      },
    },
  };
};

describe("transactional AuditEvent and OutboxEvent persistence", () => {
  beforeEach(async () => {
    await IdempotencyRecord.createIndexes();
    await AuditEvent.createIndexes();
    await OutboxEvent.createIndexes();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const executeDirectProductCreate = ({
    name = "Direct product",
    productSku = "DIRECT-1",
    payloadSku = "DIRECT-1",
    metadata = {},
    mutateDescriptor,
    buildResponse = (product) => ({ data: product }),
    dependencies,
    duplicateDescriptor = false,
  } = {}) => {
    const requestId = "018f71c3-6aea-48e1-9e0f-098c0306d9ad";
    const operationId = "catalog.product.create.v1";
    return executeInventoryMutation({
      context: {
        requestId,
        correlationId: "direct-audit-test",
        causationId: requestId,
        source: "http-api",
        actor: { type: "user", id: "64b64c6f2f0f000000000099" },
      },
      inventoryOperation: { operationId, keyHash: null },
      command: buildCanonicalCommand({
        operationId,
        normalizedBody: { sku: productSku, name },
      }),
      statusCode: 201,
      execute: async ({ session, eventCollector }) => {
        const [product] = await Product.create(
          [{ sku: productSku, name }],
          { session }
        );
        const descriptor = {
          eventType: "catalog.product.created",
          aggregateType: "Product",
          aggregateId: product._id.toString(),
          aggregateVersion: product.version,
          before: null,
          after: buildProductSnapshot(product),
          payload: {
            productId: product._id.toString(),
            sku: payloadSku,
            status: product.status,
            aggregateVersion: product.version,
          },
          metadata,
        };
        if (mutateDescriptor) mutateDescriptor(descriptor);
        eventCollector.recordChange(descriptor);
        if (duplicateDescriptor) eventCollector.recordChange(descriptor);
        return product;
      },
      buildResponse,
      dependencies,
    });
  };

  it("writes a matched unkeyed event pair with server context and safe snapshots", async () => {
    const token = await createManagerToken();
    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Correlation-ID", "order.audit.1")
      .set("X-Causation-ID", "client-controlled-causation")
      .send({ sku: "AUDIT-PAIR-1", name: "Pair product" });

    expect(response.status).toBe(201);
    const audit = await AuditEvent.findOne({}).lean();
    const outbox = await OutboxEvent.findOne({}).lean();
    expect(audit).toMatchObject({
      action: "catalog.product.create.v1",
      resource: { type: "Product", aggregateVersion: 1 },
      outcome: "succeeded",
      requestId: response.headers["x-request-id"],
      correlationId: "order.audit.1",
      causationId: response.headers["x-request-id"],
      source: "http-api",
      idempotency: null,
      before: null,
    });
    expect(outbox).toMatchObject({
      eventType: "catalog.product.created",
      eventVersion: 1,
      payloadSchemaVersion: 1,
      aggregate: {
        type: audit.resource.type,
        id: audit.resource.id,
        version: audit.resource.aggregateVersion,
      },
      requestId: audit.requestId,
      correlationId: audit.correlationId,
      causationId: audit.causationId,
      idempotency: null,
      delivery: { status: "pending", attempts: 0 },
    });
    expect(outbox.delivery.nextAttemptAt).toEqual(outbox.occurredAt);
    expect(audit.after.snapshot).not.toHaveProperty("__v");
    expect(audit.after.snapshot).not.toHaveProperty("createdAt");
  });

  it("rejects credential material before a keyed inventory mutation can persist or log it", async () => {
    const marker = "Bearer test-token-do-not-store";
    const key = "durable-secret-test-1";
    const token = await createManagerToken();
    const product = await Product.create({
      sku: "DURABLE-BOUNDARY-P1",
      name: "Durable boundary product",
    });
    const warehouse = await Warehouse.create({
      code: "DURABLE-BOUNDARY-W1",
      name: "Durable boundary warehouse",
    });
    const stock = await Stock.create({
      productId: product._id,
      warehouseId: warehouse._id,
      quantity: 0,
    });
    const { output, destination } = createLogCapture();
    const logger = createLogger({
      destination,
      environment: "production",
      level: "info",
    });

    const response = await request(createApp({ logger }))
      .post("/api/v1/goods-receipts")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .set("X-Request-ID", "durable-boundary-request-1")
      .set("X-Correlation-ID", "durable-boundary-correlation-1")
      .send({
        stockId: stock._id,
        quantity: 3,
        reference: marker,
        reason: "Supplier packaging delay",
      });
    logger.flush();

    const persisted = {
      stock: await Stock.findById(stock._id).lean(),
      movements: await StockMovement.find({}).lean(),
      audits: await AuditEvent.find({}).lean(),
      outboxes: await OutboxEvent.find({}).lean(),
      idempotency: await IdempotencyRecord.find({}).lean(),
    };
    const responseJson = JSON.stringify(response.body);
    const logOutput = output.join("");

    expect({
      status: response.status,
      code: response.body.code,
      retryable: response.body.retryable,
      requestId: response.body.requestId,
      correlationId: response.body.correlationId,
      errorField: response.body.errors?.[0]?.field,
      stockQuantity: persisted.stock.quantity,
      movements: persisted.movements.length,
      audits: persisted.audits.length,
      outboxes: persisted.outboxes.length,
      idempotencyRecords: persisted.idempotency.length,
      processingRecords: persisted.idempotency.filter(
        ({ state }) => state === "processing"
      ).length,
      completedRecords: persisted.idempotency.filter(
        ({ state }) => state === "completed"
      ).length,
      markerInStock: JSON.stringify(persisted.stock).includes(marker),
      markerInStockMovement: JSON.stringify(persisted.movements).includes(marker),
      markerInAudit: JSON.stringify(persisted.audits).includes(marker),
      markerInOutbox: JSON.stringify(persisted.outboxes).includes(marker),
      markerInIdempotency: JSON.stringify(persisted.idempotency).includes(marker),
      markerInResponse: responseJson.includes(marker),
      markerInLogs: logOutput.includes(marker),
    }).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
      retryable: false,
      requestId: "durable-boundary-request-1",
      correlationId: "durable-boundary-correlation-1",
      errorField: "reference",
      stockQuantity: 0,
      movements: 0,
      audits: 0,
      outboxes: 0,
      idempotencyRecords: 0,
      processingRecords: 0,
      completedRecords: 0,
      markerInStock: false,
      markerInStockMovement: false,
      markerInAudit: false,
      markerInOutbox: false,
      markerInIdempotency: false,
      markerInResponse: false,
      markerInLogs: false,
    });

    const safePayload = {
      stockId: stock._id,
      quantity: 3,
      reference: "PO-2026-0001",
      reason: "Supplier packaging delay",
    };
    const safeResponse = await request(createApp({ logger }))
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(safePayload);
    const replay = await request(createApp({ logger }))
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(safePayload);
    logger.flush();

    expect(safeResponse.status).toBe(201);
    expect(safeResponse.headers["idempotency-replayed"]).toBe("false");
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body).toEqual(safeResponse.body);

    const movement = await StockMovement.findOne({}).lean();
    const audit = await AuditEvent.findOne({}).lean();
    const outbox = await OutboxEvent.findOne({}).lean();
    const idempotency = await IdempotencyRecord.findOne({}).lean();
    expect(movement).toMatchObject({
      reference: safePayload.reference,
      reason: safePayload.reason,
    });
    expect(audit.metadata).not.toHaveProperty("reference");
    expect(outbox.payload.reference).toBeNull();
    expect(idempotency.state).toBe("completed");
    expect(idempotency.responseBody).toEqual(safeResponse.body);
    expect(idempotency.responseBody.data.stockMovement).not.toHaveProperty(
      "reference"
    );
    expect(idempotency.responseBody.data.stockMovement).not.toHaveProperty(
      "reason"
    );
    expect(safeResponse.body.data.stockMovement).not.toHaveProperty(
      "reference"
    );
    expect(safeResponse.body.data.stockMovement).not.toHaveProperty("reason");
    expect(safeResponse.body.data.stockMovement.productSnapshot.name).toBe(
      product.name
    );
    expect(safeResponse.body.data.stockMovement.warehouseSnapshot.name).toBe(
      warehouse.name
    );
    for (const value of [safePayload.reference, safePayload.reason]) {
      expect(JSON.stringify(audit)).not.toContain(value);
      expect(JSON.stringify(outbox)).not.toContain(value);
      expect(JSON.stringify(idempotency.responseBody)).not.toContain(value);
      expect(JSON.stringify(safeResponse.body)).not.toContain(value);
    }
    expect(await StockMovement.countDocuments()).toBe(1);
    expect(await AuditEvent.countDocuments()).toBe(1);
    expect(await OutboxEvent.countDocuments()).toBe(1);
    expect(await IdempotencyRecord.countDocuments({ state: "processing" })).toBe(
      0
    );
    expect(await IdempotencyRecord.countDocuments({ state: "completed" })).toBe(
      1
    );
  });

  it("rejects credential material before a keyed lifecycle mutation can persist or log it", async () => {
    const marker = "apiKey=test-lifecycle-value";
    const token = await createManagerToken();
    const product = await Product.create({
      sku: "DURABLE-LIFECYCLE-P1",
      name: "Durable lifecycle product",
    });
    const { output, destination } = createLogCapture();
    const logger = createLogger({
      destination,
      environment: "production",
      level: "info",
    });

    const response = await request(createApp({ logger }))
      .patch(`/api/v1/products/${product._id}/deactivate`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "durable-lifecycle-test-1")
      .send({
        expectedVersion: product.version,
        deactivationReason: marker,
      });
    logger.flush();

    const persisted = {
      product: await Product.findById(product._id).lean(),
      audits: await AuditEvent.find({}).lean(),
      outboxes: await OutboxEvent.find({}).lean(),
      idempotency: await IdempotencyRecord.find({}).lean(),
    };

    expect({
      status: response.status,
      code: response.body.code,
      productStatus: persisted.product.status,
      productVersion: persisted.product.version,
      audits: persisted.audits.length,
      outboxes: persisted.outboxes.length,
      idempotencyRecords: persisted.idempotency.length,
      markerInProduct: JSON.stringify(persisted.product).includes(marker),
      markerInAudit: JSON.stringify(persisted.audits).includes(marker),
      markerInOutbox: JSON.stringify(persisted.outboxes).includes(marker),
      markerInIdempotency: JSON.stringify(persisted.idempotency).includes(marker),
      markerInResponse: JSON.stringify(response.body).includes(marker),
      markerInLogs: output.join("").includes(marker),
    }).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
      productStatus: "active",
      productVersion: 1,
      audits: 0,
      outboxes: 0,
      idempotencyRecords: 0,
      markerInProduct: false,
      markerInAudit: false,
      markerInOutbox: false,
      markerInIdempotency: false,
      markerInResponse: false,
      markerInLogs: false,
    });
  });

  it("rejects credential material in movement reason before any keyed write", async () => {
    const marker = "secret=test-reason";
    const token = await createManagerToken();
    const product = await Product.create({
      sku: "DURABLE-REASON-P1",
      name: "Durable reason product",
    });
    const warehouse = await Warehouse.create({
      code: "DURABLE-REASON-W1",
      name: "Durable reason warehouse",
    });
    const stock = await Stock.create({
      productId: product._id,
      warehouseId: warehouse._id,
      quantity: 0,
    });
    const { output, destination } = createLogCapture();
    const logger = createLogger({
      destination,
      environment: "production",
      level: "info",
    });

    const response = await request(createApp({ logger }))
      .post("/api/v1/goods-receipts")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "durable-reason-test-1")
      .send({
        stockId: stock._id,
        quantity: 2,
        reference: "PO-REASON-1",
        reason: marker,
      });
    logger.flush();

    const persisted = {
      stock: await Stock.findById(stock._id).lean(),
      movements: await StockMovement.find({}).lean(),
      audits: await AuditEvent.find({}).lean(),
      outboxes: await OutboxEvent.find({}).lean(),
      idempotency: await IdempotencyRecord.find({}).lean(),
    };

    expect({
      status: response.status,
      code: response.body.code,
      stockQuantity: persisted.stock.quantity,
      movements: persisted.movements.length,
      audits: persisted.audits.length,
      outboxes: persisted.outboxes.length,
      idempotencyRecords: persisted.idempotency.length,
      markerInStockMovement: JSON.stringify(persisted.movements).includes(marker),
      markerInAudit: JSON.stringify(persisted.audits).includes(marker),
      markerInOutbox: JSON.stringify(persisted.outboxes).includes(marker),
      markerInIdempotency: JSON.stringify(persisted.idempotency).includes(marker),
      markerInResponse: JSON.stringify(response.body).includes(marker),
      markerInLogs: output.join("").includes(marker),
    }).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
      stockQuantity: 0,
      movements: 0,
      audits: 0,
      outboxes: 0,
      idempotencyRecords: 0,
      markerInStockMovement: false,
      markerInAudit: false,
      markerInOutbox: false,
      markerInIdempotency: false,
      markerInResponse: false,
      markerInLogs: false,
    });
  });

  it("rejects a safe-unsafe-safe bulk mutation atomically", async () => {
    const marker = "password=hunter2-test";
    const token = await createManagerToken();
    const product = await Product.create({
      sku: "DURABLE-BULK-P1",
      name: "Durable bulk product",
    });
    const warehouse = await Warehouse.create({
      code: "DURABLE-BULK-W1",
      name: "Durable bulk warehouse",
    });
    const stock = await Stock.create({
      productId: product._id,
      warehouseId: warehouse._id,
      quantity: 0,
    });

    const response = await request(app)
      .post("/api/v1/goods-receipts/bulk")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "durable-bulk-test-1")
      .send([
        {
          stockId: stock._id,
          quantity: 1,
          reference: "PO-BULK-SAFE-1",
        },
        { stockId: stock._id, quantity: 2, reason: marker },
        {
          stockId: stock._id,
          quantity: 3,
          reference: "PO-BULK-SAFE-3",
        },
      ]);

    expect(response).toMatchObject({
      status: 400,
      body: {
        code: "VALIDATION_FAILED",
        retryable: false,
        errors: [expect.objectContaining({ field: "reason" })],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(marker);
    await expect(Stock.findById(stock._id).lean()).resolves.toMatchObject({
      quantity: 0,
      version: 1,
    });
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
  });

  it("creates Audit only for no-change and keyed replay creates nothing new", async () => {
    const token = await createManagerToken();
    const product = await Product.create({ sku: "NO-CHANGE-1", name: "Same" });
    const key = "audit.no-change.0001";
    const original = await request(app)
      .patch(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ name: "Same", expectedVersion: product.version });
    const replay = await request(app)
      .patch(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ name: "Same", expectedVersion: product.version });

    expect(original.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(await AuditEvent.countDocuments()).toBe(1);
    expect(await OutboxEvent.countDocuments()).toBe(0);
    const audit = await AuditEvent.findOne({}).lean();
    const record = await IdempotencyRecord.findOne({}).lean();
    expect(audit).toMatchObject({
      outcome: "no_change",
      reasonCode: "NO_STATE_CHANGE",
      idempotency: {
        recordId: record._id.toString(),
        keyHash: record.keyHash,
      },
    });
    expect(audit.before.hash).toBe(audit.after.hash);
    expect(audit.before.snapshot).toEqual(audit.after.snapshot);
  });

  it("creates separate Audit-only records for unkeyed Product and Warehouse no-ops", async () => {
    const token = await createManagerToken();
    const product = await Product.create({ sku: "NO-CHANGE-2", name: "Same" });
    const warehouse = await Warehouse.create({ code: "NO-CHANGE-W", name: "Same" });

    const responses = [
      await request(app)
        .patch(`/api/products/${product._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Same", expectedVersion: product.version }),
      await request(app)
        .patch(`/api/warehouses/${warehouse._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Same", expectedVersion: warehouse.version }),
      await request(app)
        .patch(`/api/products/${product._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Same", expectedVersion: product.version }),
    ];

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(await AuditEvent.countDocuments({ outcome: "no_change" })).toBe(3);
    expect(await OutboxEvent.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments({ "resource.type": "Product" })).toBe(2);
    expect(await AuditEvent.countDocuments({ "resource.type": "Warehouse" })).toBe(1);
  });

  it("creates exact changed and no-change records in one bulk update", async () => {
    const token = await createManagerToken();
    const [unchanged, changed] = await Product.create([
      { sku: "MIXED-1", name: "Same" },
      { sku: "MIXED-2", name: "Before" },
    ]);
    const response = await request(app)
      .patch("/api/products/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send([
        { id: unchanged._id, name: "Same", expectedVersion: unchanged.version },
        { id: changed._id, name: "After", expectedVersion: changed.version },
      ]);

    expect(response.status).toBe(200);
    const audits = await AuditEvent.find({}).sort({ "metadata.bulkItemIndex": 1 }).lean();
    expect(audits.map(({ outcome }) => outcome)).toEqual([
      "no_change",
      "succeeded",
    ]);
    expect(audits.map(({ resource }) => resource.id)).toEqual([
      unchanged._id.toString(),
      changed._id.toString(),
    ]);
    expect(await OutboxEvent.countDocuments()).toBe(1);
    expect(await OutboxEvent.findOne({}).lean()).toMatchObject({
      eventType: "catalog.product.updated",
      aggregate: { id: changed._id.toString(), version: 2 },
    });
  });

  it("commits one event pair when same-key requests race", async () => {
    const token = await createManagerToken();
    const create = () =>
      request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "audit.concurrent.0001")
        .send({ sku: "CONCURRENT-EVENT-1", name: "Concurrent" });
    const [first, second] = await Promise.all([create(), create()]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(
      [
        first.headers["idempotency-replayed"],
        second.headers["idempotency-replayed"],
      ].sort()
    ).toEqual(["false", "true"]);
    expect(await Product.countDocuments()).toBe(1);
    expect(await AuditEvent.countDocuments()).toBe(1);
    expect(await OutboxEvent.countDocuments()).toBe(1);
    expect(await IdempotencyRecord.countDocuments()).toBe(1);
  });

  it("rolls back domain, movement, events, and acquisition when event insertion fails", async () => {
    const token = await createManagerToken();
    jest
      .spyOn(OutboxEvent, "insertMany")
      .mockRejectedValueOnce(new Error("Injected outbox insertion failure"));

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "audit.rollback.0001")
      .send({ sku: "ROLLBACK-1", name: "Rollback" });

    expect(response.status).toBe(500);
    expect(await Product.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
  });

  it("rolls back on Audit insertion failure and response serialization failure", async () => {
    const auditInsertionError = new Error("Injected audit insertion failure");
    jest
      .spyOn(AuditEvent, "insertMany")
      .mockRejectedValueOnce(auditInsertionError);
    const failure = await executeDirectProductCreate().catch((error) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      safeMessage: "Could not complete request",
      cause: auditInsertionError,
    });
    expect(await Product.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);

    const circular = {};
    circular.self = circular;
    await expect(
      executeDirectProductCreate({ buildResponse: () => circular })
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
    expect(await Product.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  it("rolls back Warehouse guards, Stock creation, and receipt/issue failures", async () => {
    const token = await createManagerToken();

    const warehouseProduct = await Product.create({
      sku: "ROLLBACK-W-P",
      name: "Warehouse rollback product",
    });
    const warehouse = await Warehouse.create({
      code: "ROLLBACK-W",
      name: "Warehouse rollback",
    });
    const warehouseStock = await Stock.create({
      productId: warehouseProduct._id,
      warehouseId: warehouse._id,
      quantity: 0,
    });
    jest
      .spyOn(Stock, "findOneAndUpdate")
      .mockRejectedValueOnce(new Error("Injected warehouse guard failure"));
    const warehouseFailure = await request(app)
      .patch(`/api/warehouses/${warehouse._id}/deactivate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        deactivationReason: "planned",
        expectedVersion: warehouse.version,
      });
    expect(warehouseFailure.status).toBe(500);
    expect(await Warehouse.findById(warehouse._id).lean()).toMatchObject({
      status: "active",
      version: 1,
    });
    expect(await Stock.findById(warehouseStock._id).lean()).toMatchObject({
      version: 1,
      warehouseLifecycleStatus: "active",
    });
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
    jest.restoreAllMocks();

    const stockProduct = await Product.create({
      sku: "ROLLBACK-S-P",
      name: "Stock rollback product",
    });
    const stockWarehouse = await Warehouse.create({
      code: "ROLLBACK-S-W",
      name: "Stock rollback warehouse",
    });
    jest
      .spyOn(AuditEvent, "insertMany")
      .mockRejectedValueOnce(new Error("Injected Stock audit failure"));
    const stockFailure = await request(app)
      .post("/api/stocks")
      .set("Authorization", `Bearer ${token}`)
      .send({
        productId: stockProduct._id,
        warehouseId: stockWarehouse._id,
      });
    expect(stockFailure.status).toBe(500);
    expect(await Stock.countDocuments({ productId: stockProduct._id })).toBe(0);
    expect(await Product.findById(stockProduct._id).lean()).toMatchObject({
      version: 1,
    });
    expect(await Warehouse.findById(stockWarehouse._id).lean()).toMatchObject({
      version: 1,
    });
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
    jest.restoreAllMocks();

    const movementProduct = await Product.create({
      sku: "ROLLBACK-M-P",
      name: "Movement rollback product",
    });
    const movementWarehouse = await Warehouse.create({
      code: "ROLLBACK-M-W",
      name: "Movement rollback warehouse",
    });
    const movementStock = await Stock.create({
      productId: movementProduct._id,
      warehouseId: movementWarehouse._id,
      quantity: 10,
    });
    jest
      .spyOn(StockMovement, "create")
      .mockRejectedValueOnce(new Error("Injected movement insertion failure"));
    const receiptFailure = await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${token}`)
      .send({ stockId: movementStock._id, quantity: 2 });
    expect(receiptFailure.status).toBe(500);
    expect(await Stock.findById(movementStock._id).lean()).toMatchObject({
      quantity: 10,
      version: 1,
    });
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
    jest.restoreAllMocks();

    jest
      .spyOn(OutboxEvent, "insertMany")
      .mockRejectedValueOnce(new Error("Injected issue outbox failure"));
    const issueFailure = await request(app)
      .post("/api/goods-issues")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "rollback.issue.0001")
      .send({ stockId: movementStock._id, quantity: 3 });
    expect(issueFailure.status).toBe(500);
    expect(await Stock.findById(movementStock._id).lean()).toMatchObject({
      quantity: 10,
      version: 1,
    });
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
  });

  it("rolls back a domain update on a duplicate aggregate-version Outbox conflict", async () => {
    const token = await createManagerToken();
    const product = await Product.create({
      sku: "OUTBOX-CONFLICT-1",
      name: "Before",
    });
    const occurredAt = new Date();
    const requestId = randomUUID();
    const payload = {
      productId: product._id.toString(),
      sku: product.sku,
      changedFields: ["name"],
      aggregateVersion: 2,
    };
    await OutboxEvent.create({
      eventId: randomUUID(),
      eventType: "catalog.product.updated",
      eventVersion: 1,
      payloadSchemaVersion: 1,
      producer: "inventory-management-api",
      aggregate: {
        type: "Product",
        id: product._id.toString(),
        version: 2,
      },
      occurredAt,
      requestId,
      correlationId: "preexisting-conflict",
      causationId: requestId,
      source: "http-api",
      idempotency: null,
      payload,
      payloadSizeBytes: Buffer.byteLength(canonicalize(payload), "utf8"),
      delivery: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: occurredAt,
        lastAttemptAt: null,
        deliveredAt: null,
        lastError: null,
      },
    });

    const response = await request(app)
      .patch(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Must roll back", expectedVersion: product.version });

    expect(response.status).toBe(500);
    expect(await Product.findById(product._id).lean()).toMatchObject({
      name: "Before",
      version: 1,
    });
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(1);
  });

  it("rolls back exact audit and outbox serialization/size failures without truncation", async () => {
    await expect(
      executeDirectProductCreate({
        mutateDescriptor: (descriptor) => {
          descriptor.after.sku = "É".repeat(9_000);
        },
      })
    ).rejects.toMatchObject({ code: "AUDIT_SNAPSHOT_TOO_LARGE" });
    await expect(
      executeDirectProductCreate({
        metadata: {
          linkedStockIds: Array.from({ length: 150 }, (_, index) =>
            String(index).padStart(128, "0")
          ),
          linkedStockCount: 150,
        },
        mutateDescriptor: (descriptor) => {
          descriptor.eventType = "catalog.product.stock-linked";
          descriptor.payload = {
            productId: descriptor.aggregateId,
            sku: descriptor.payload.sku,
            linkedStockIds: descriptor.metadata.linkedStockIds,
            linkedCount: descriptor.metadata.linkedStockCount,
            aggregateVersion: descriptor.aggregateVersion,
          };
        },
      })
    ).rejects.toMatchObject({ code: "AUDIT_METADATA_TOO_LARGE" });
    await expect(
      executeDirectProductCreate({
        dependencies: {
          eventPersistence: (args) =>
            persistAuditOutboxEvents({
              ...args,
              resolveEventDefinition: (eventType) => {
                const definition = getEventDefinition(eventType);
                return {
                  ...definition,
                  payloadBuilder: (payload) => ({
                    ...definition.payloadBuilder(payload),
                    integrationNote: "é".repeat(33_000),
                  }),
                };
              },
            }),
        },
      })
    ).rejects.toMatchObject({ code: "OUTBOX_PAYLOAD_TOO_LARGE" });

    await expect(
      executeDirectProductCreate({
        mutateDescriptor: (descriptor) => {
          descriptor.payload.circular = descriptor.payload;
        },
      })
    ).rejects.toMatchObject({ code: "EVENT_SERIALIZATION_FAILED" });
    expect(await Product.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  it("rejects duplicate descriptors for one aggregate version before persistence", async () => {
    await expect(
      executeDirectProductCreate({ duplicateDescriptor: true })
    ).rejects.toMatchObject({ code: "EVENT_DESCRIPTOR_INVALID" });
    expect(await Product.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  it("authentication, RBAC, validation, and domain failures create no events", async () => {
    const token = await createManagerToken();
    const viewerToken = await createViewerToken();
    await Product.create({ sku: "DUPLICATE-1", name: "Existing" });
    const responses = [
      await request(app).post("/api/products").send({
        sku: "BLOCKED-AUTH",
        name: "Blocked",
      }),
      await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ sku: "BLOCKED-RBAC", name: "Blocked" }),
      await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({ sku: "bad sku", name: "Invalid" }),
      await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({ sku: "DUPLICATE-1", name: "Duplicate" }),
    ];
    expect(responses.map(({ status }) => status)).toEqual([401, 403, 400, 409]);
    expect(await AuditEvent.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  it("persists no actor PII, raw commands, raw keys, or business text in events", async () => {
    const token = await createManagerToken();
    const businessName = "Secure event product";
    const businessDescription = "Routine catalog description";
    const rawKey = "raw.key.must.not.persist.0001";
    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", rawKey)
      .send({
        sku: "SECURE-EVENT-1",
        name: businessName,
        description: businessDescription,
      });
    expect(response.status).toBe(201);

    const documents = [
      await AuditEvent.findOne({}).lean(),
      await OutboxEvent.findOne({}).lean(),
    ];
    const actor = await User.findOne({ role: "manager" })
      .select("+password")
      .lean();
    const forbiddenKeys = new Set(
      [
        "password",
        "passwordHash",
        "accessToken",
        "refreshToken",
        "authorization",
        "cookie",
        "jwt",
        "secret",
        "mongodbUri",
        "email",
        "name",
        "role",
        "rawIdempotencyKey",
        "requestBody",
        "responseBody",
        "headers",
        "stack",
        "error",
      ].map((key) => key.toLowerCase())
    );
    const inspect = (value) => {
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbiddenKeys.has(key.toLowerCase())).toBe(false);
        inspect(child);
      }
    };
    documents.forEach(inspect);
    const serialized = JSON.stringify(documents);
    for (const forbiddenValue of [
      businessName,
      businessDescription,
      rawKey,
      token,
      actor.name,
      actor.email,
      actor.password,
      actor.role,
    ].filter(Boolean)) {
      expect(serialized).not.toContain(forbiddenValue);
    }
  });
});
