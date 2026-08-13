const { randomUUID } = require("crypto");

const OutboxEvent = require("../src/models/OutboxEvent");
const { canonicalize } = require("../src/utils/canonicalJson");
const { serializeBoundedJson } = require("../src/utils/boundedJson");
const errorCodes = require("../src/errors/errorCodes");

require("./setupTestDb");

const buildRecord = (overrides = {}) => {
  const occurredAt = new Date();
  const requestId = randomUUID();
  const payload = {
    productId: "64b64c6f2f0f000000000001",
    sku: "OUTBOX-1",
    status: "active",
    aggregateVersion: 1,
  };
  return {
    eventId: randomUUID(),
    eventType: "catalog.product.created",
    eventVersion: 1,
    payloadSchemaVersion: 1,
    producer: "inventory-management-api",
    aggregate: { type: "Product", id: payload.productId, version: 1 },
    occurredAt,
    requestId,
    correlationId: "outbox-test",
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
    ...overrides,
  };
};

describe("OutboxEvent model", () => {
  it("declares exact non-TTL indexes with automatic indexing disabled", () => {
    expect(OutboxEvent.schema.options.autoIndex).toBe(false);
    expect(OutboxEvent.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ eventId: 1 }, { name: "uq_outbox_event_id", unique: true }],
        [
          { "aggregate.type": 1, "aggregate.id": 1, "aggregate.version": 1 },
          { name: "uq_outbox_aggregate_version", unique: true },
        ],
        [
          { "delivery.status": 1, "delivery.nextAttemptAt": 1, createdAt: 1 },
          { name: "idx_outbox_delivery_pending" },
        ],
        [
          { correlationId: 1, createdAt: 1 },
          { name: "idx_outbox_correlation_created_at" },
        ],
      ])
    );
    expect(
      OutboxEvent.schema.indexes().some(([, options]) =>
        Object.prototype.hasOwnProperty.call(options, "expireAfterSeconds")
      )
    ).toBe(false);
  });

  it("accepts only registered versioned payloads and immediate pending delivery", async () => {
    await expect(new OutboxEvent(buildRecord()).validate()).resolves.toBeUndefined();
    await expect(
      new OutboxEvent(buildRecord({ eventType: "unknown.event" })).validate()
    ).rejects.toMatchObject({ code: "EVENT_DESCRIPTOR_INVALID" });
    await expect(
      new OutboxEvent(buildRecord({ payloadSizeBytes: 1 })).validate()
    ).rejects.toThrow("does not match");
    const later = buildRecord();
    later.delivery.nextAttemptAt = new Date(later.occurredAt.getTime() + 1);
    await expect(new OutboxEvent(later).validate()).rejects.toThrow(
      "start immediately pending"
    );
  });

  it.each(["http-api", "internal"])("accepts the approved %s source", async (source) => {
    await expect(new OutboxEvent(buildRecord({ source })).validate()).resolves.toBeUndefined();
  });

  it("rejects an arbitrary source", async () => {
    await expect(
      new OutboxEvent(buildRecord({ source: "queue" })).validate()
    ).rejects.toThrow();
  });

  it.each([
    ["UUID", { eventId: "not-a-uuid" }],
    ["event version", { eventVersion: 2 }],
    ["payload schema version", { payloadSchemaVersion: 2 }],
    ["producer", { producer: "another-service" }],
    ["aggregate type", { aggregate: { type: "User", id: "id", version: 1 } }],
    [
      "aggregate version",
      {
        aggregate: {
          type: "Product",
          id: "64b64c6f2f0f000000000001",
          version: 0,
        },
      },
    ],
    ["context bound", { requestId: "x".repeat(129) }],
    ["causation", { requestId: "request", causationId: "client" }],
    ["idempotency hash", { idempotency: { recordId: "id", keyHash: "bad" } }],
    [
      "delivery attempts",
      {
        delivery: {
          status: "pending",
          attempts: 1,
          nextAttemptAt: new Date(),
          lastAttemptAt: null,
          deliveredAt: null,
          lastError: null,
        },
      },
    ],
  ])("rejects invalid %s", async (label, override) => {
    await expect(new OutboxEvent(buildRecord(override)).validate()).rejects.toThrow();
  });

  it("keeps envelope and payload immutable after creation", async () => {
    const record = await OutboxEvent.create(buildRecord());
    record.eventType = "catalog.product.updated";
    record.payload = { altered: true };
    await expect(record.save()).rejects.toThrow("immutable");
    await expect(
      OutboxEvent.updateOne(
        { _id: record._id },
        { $set: { "aggregate.version": 2 } }
      )
    ).rejects.toThrow("immutable");
    await expect(
      OutboxEvent.updateOne(
        { _id: record._id },
        [{ $set: { requestId: "pipeline-tamper" } }],
        { updatePipeline: true }
      )
    ).rejects.toThrow("immutable");
    await expect(
      OutboxEvent.bulkWrite([
        {
          updateOne: {
            filter: { _id: record._id },
            update: { $set: { payload: { altered: true } } },
          },
        },
      ])
    ).rejects.toThrow("immutable");
    const stored = await OutboxEvent.findById(record._id).lean();
    expect(stored.eventType).toBe("catalog.product.created");
    expect(stored.requestId).not.toBe("pipeline-tamper");
    expect(stored.payload).toMatchObject({ sku: "OUTBOX-1" });
  });

  it("rejects a registered event bound to the wrong aggregate type", async () => {
    const record = buildRecord();
    record.aggregate = {
      type: "Warehouse",
      id: "64b64c6f2f0f000000000002",
      version: 1,
    };
    await expect(new OutboxEvent(record).validate()).rejects.toThrow(
      "does not match envelope"
    );
  });

  it("enforces the exact 65,536-byte UTF-8 payload boundary", () => {
    const emptySize = Buffer.byteLength('{"value":""}', "utf8");
    expect(
      serializeBoundedJson({
        value: { value: "x".repeat(65_536 - emptySize) },
        maxBytes: 65_536,
        tooLargeCode: errorCodes.OUTBOX_PAYLOAD_TOO_LARGE,
        tooLargeMessage: "too large",
      }).sizeBytes
    ).toBe(65_536);
    expect(() =>
      serializeBoundedJson({
        value: { value: "x".repeat(65_537 - emptySize) },
        maxBytes: 65_536,
        tooLargeCode: errorCodes.OUTBOX_PAYLOAD_TOO_LARGE,
        tooLargeMessage: "too large",
      })
    ).toThrow(expect.objectContaining({ code: "OUTBOX_PAYLOAD_TOO_LARGE" }));
  });
});
