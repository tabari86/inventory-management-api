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

const immutableEventSnapshot = (record) => ({
  createdAt: record.createdAt,
  eventId: record.eventId,
  eventType: record.eventType,
  eventVersion: record.eventVersion,
  payloadSchemaVersion: record.payloadSchemaVersion,
  producer: record.producer,
  aggregate: record.aggregate,
  payload: record.payload,
  payloadSizeBytes: record.payloadSizeBytes,
  occurredAt: record.occurredAt,
  requestId: record.requestId,
  correlationId: record.correlationId,
  causationId: record.causationId,
  source: record.source,
  idempotency: record.idempotency,
});

const buildDistinctRecord = (suffix) => {
  const record = buildRecord();
  const productId = `64b64c6f2f0f000000000${String(suffix).padStart(3, "0")}`;
  record.aggregate = { ...record.aggregate, id: productId };
  record.payload = {
    ...record.payload,
    productId,
    sku: `OUTBOX-${suffix}`,
  };
  record.payloadSizeBytes = Buffer.byteLength(canonicalize(record.payload), "utf8");
  return record;
};

const waitForTimestampTick = () =>
  new Promise((resolve) => setTimeout(resolve, 5));

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
    const blockedUpdates = [
      { $set: { eventId: randomUUID() } },
      { $set: { eventType: "catalog.product.updated" } },
      { $set: { payload: { altered: true } } },
      { $set: { "aggregate.version": 2 } },
      { $set: { requestId: "tampered-request" } },
      { $set: { occurredAt: new Date(0) } },
      {
        $set: {
          idempotency: { recordId: "tampered", keyHash: "a".repeat(64) },
        },
      },
      { $set: { payloadSizeBytes: 2 } },
    ];
    for (const update of blockedUpdates) {
      await expect(
        OutboxEvent.updateOne({ _id: record._id }, update)
      ).rejects.toThrow("immutable");
    }
    await expect(
      OutboxEvent.updateOne(
        { _id: record._id },
        [{ $set: { requestId: "pipeline-tamper" } }],
        { updatePipeline: true }
      )
    ).rejects.toThrow("immutable");
    await expect(
      OutboxEvent.updateOne(
        { _id: record._id },
        [{ $project: { delivery: 1 } }],
        { updatePipeline: true }
      )
    ).rejects.toThrow("pipeline is not supported");
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

  it("allows a validated delivery-only update with automatic timestamps", async () => {
    const created = await OutboxEvent.create(buildRecord());
    const before = await OutboxEvent.findById(created._id).lean();
    await waitForTimestampTick();

    const result = await OutboxEvent.updateOne(
      { _id: created._id },
      { $set: { "delivery.lastError": "diagnostic" } },
      { runValidators: true }
    );

    expect(result.matchedCount).toBe(1);
    expect(result.modifiedCount).toBe(1);
    const after = await OutboxEvent.findById(created._id).lean();
    expect(after.delivery).toEqual({
      ...before.delivery,
      lastError: "diagnostic",
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(immutableEventSnapshot(after)).toEqual(immutableEventSnapshot(before));
  });

  it("allows delivery-only updateMany with automatic timestamps", async () => {
    const created = await OutboxEvent.create([
      buildDistinctRecord(2),
      buildDistinctRecord(3),
    ]);
    const ids = created.map((record) => record._id);
    const before = await OutboxEvent.find({ _id: { $in: ids } }).lean();
    await waitForTimestampTick();

    const result = await OutboxEvent.updateMany(
      { _id: { $in: ids } },
      { $set: { "delivery.lastError": "batch-diagnostic" } },
      { runValidators: true }
    );

    expect(result.matchedCount).toBe(2);
    expect(result.modifiedCount).toBe(2);
    const after = await OutboxEvent.find({ _id: { $in: ids } }).lean();
    const beforeById = new Map(before.map((record) => [String(record._id), record]));
    for (const record of after) {
      const original = beforeById.get(String(record._id));
      expect(record.delivery).toEqual({
        ...original.delivery,
        lastError: "batch-diagnostic",
      });
      expect(record.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
      expect(immutableEventSnapshot(record)).toEqual(
        immutableEventSnapshot(original)
      );
    }
  });

  it("allows delivery-only findOneAndUpdate with automatic timestamps", async () => {
    const created = await OutboxEvent.create(buildDistinctRecord(4));
    const before = await OutboxEvent.findById(created._id).lean();
    await waitForTimestampTick();

    const returned = await OutboxEvent.findOneAndUpdate(
      { _id: created._id },
      { $set: { "delivery.lastError": "find-diagnostic" } },
      { returnDocument: "after", runValidators: true }
    ).lean();

    expect(returned.delivery.lastError).toBe("find-diagnostic");
    expect(returned.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(immutableEventSnapshot(returned)).toEqual(
      immutableEventSnapshot(before)
    );
  });

  it("allows delivery-only bulkWrite updateOne with automatic timestamps", async () => {
    const created = await OutboxEvent.create(buildDistinctRecord(5));
    const before = await OutboxEvent.findById(created._id).lean();
    await waitForTimestampTick();

    const result = await OutboxEvent.bulkWrite([
      {
        updateOne: {
          filter: { _id: created._id },
          update: { $set: { "delivery.lastError": "bulk-diagnostic" } },
        },
      },
    ]);

    expect(result.matchedCount).toBe(1);
    expect(result.modifiedCount).toBe(1);
    const after = await OutboxEvent.findById(created._id).lean();
    expect(after.delivery).toEqual({
      ...before.delivery,
      lastError: "bulk-diagnostic",
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(immutableEventSnapshot(after)).toEqual(immutableEventSnapshot(before));
  });

  it("explicitly rejects delivery update upserts", async () => {
  const updateOneEventId = randomUUID();
  const findOneEventId = randomUUID();
  const bulkUpdateOneEventId = randomUUID();
  const bulkUpdateManyEventId = randomUUID();

  await expect(
    OutboxEvent.updateOne(
      { eventId: updateOneEventId },
      { $set: { "delivery.lastError": "upsert-attempt" } },
      { runValidators: true, upsert: true }
    )
  ).rejects.toThrow("update upserts are prohibited");

  await expect(
    OutboxEvent.findOneAndUpdate(
      { eventId: findOneEventId },
      { $set: { "delivery.lastError": "upsert-attempt" } },
      { runValidators: true, upsert: true }
    )
  ).rejects.toThrow("update upserts are prohibited");

  await expect(
    OutboxEvent.bulkWrite([
      {
        updateOne: {
          filter: { eventId: bulkUpdateOneEventId },
          update: { $set: { "delivery.lastError": "upsert-attempt" } },
          upsert: true,
        },
      },
    ])
  ).rejects.toThrow("update upserts are prohibited");

  await expect(
    OutboxEvent.bulkWrite([
      {
        updateMany: {
          filter: { eventId: bulkUpdateManyEventId },
          update: { $set: { "delivery.lastError": "upsert-attempt" } },
          upsert: true,
        },
      },
    ])
  ).rejects.toThrow("update upserts are prohibited");

  expect(
    await OutboxEvent.countDocuments({
      eventId: {
        $in: [
          updateOneEventId,
          findOneEventId,
          bulkUpdateOneEventId,
          bulkUpdateManyEventId,
        ],
      },
    })
  ).toBe(0);
  });

  it("blocks caller-controlled createdAt mutation paths", async () => {
    const created = await OutboxEvent.create(buildDistinctRecord(6));
    const before = await OutboxEvent.findById(created._id).lean();
    const tamperedCreatedAt = new Date(0);

    await expect(
      OutboxEvent.updateOne(
        { _id: created._id },
        { $set: { createdAt: tamperedCreatedAt } }
      )
    ).rejects.toThrow("immutable");
    await expect(
      OutboxEvent.updateOne(
        { _id: created._id },
        { createdAt: tamperedCreatedAt }
      )
    ).rejects.toThrow("immutable");
    await expect(
      OutboxEvent.updateOne(
        { _id: created._id },
        [{ $set: { createdAt: tamperedCreatedAt } }],
        { updatePipeline: true }
      )
    ).rejects.toThrow("immutable");
    await expect(
      OutboxEvent.replaceOne(
        { _id: created._id },
        { ...before, createdAt: tamperedCreatedAt }
      )
    ).rejects.toThrow("immutable");
    await expect(
      OutboxEvent.findOneAndReplace(
        { _id: created._id },
        { ...before, createdAt: tamperedCreatedAt }
      )
    ).rejects.toThrow("immutable");
    await expect(
      OutboxEvent.bulkWrite([
        {
          updateOne: {
            filter: { _id: created._id },
            update: { $set: { createdAt: tamperedCreatedAt } },
          },
        },
      ])
    ).rejects.toThrow("immutable");

    const after = await OutboxEvent.findById(created._id).lean();
    expect(after.createdAt).toEqual(before.createdAt);
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
