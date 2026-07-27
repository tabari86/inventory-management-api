const { randomUUID } = require("crypto");

const AuditEvent = require("../src/models/AuditEvent");
const { buildSnapshotEnvelope } = require("../src/services/auditOutboxService");
const { serializeBoundedJson } = require("../src/utils/boundedJson");
const errorCodes = require("../src/errors/errorCodes");

require("./setupTestDb");

const productSnapshot = {
  id: "64b64c6f2f0f000000000001",
  sku: "AUDIT-1",
  unit: "piece",
  status: "active",
  version: 1,
};

const buildRecord = (overrides = {}) => {
  const metadata = { eventType: "catalog.product.created" };
  const requestId = randomUUID();
  const metadataSizeBytes = Buffer.byteLength(
    require("../src/utils/canonicalJson").canonicalize(metadata),
    "utf8"
  );
  return {
    auditEventId: randomUUID(),
    schemaVersion: 1,
    actor: { type: "user", id: "64b64c6f2f0f000000000099" },
    action: "catalog.product.create.v1",
    resource: { type: "Product", id: productSnapshot.id, aggregateVersion: 1 },
    outcome: "succeeded",
    requestId,
    correlationId: "audit-test",
    causationId: requestId,
    source: "http-api",
    idempotency: null,
    before: null,
    after: buildSnapshotEnvelope(productSnapshot),
    reasonCode: null,
    metadata,
    metadataSizeBytes,
    occurredAt: new Date(),
    ...overrides,
  };
};

describe("AuditEvent model", () => {
  it("declares exact non-TTL indexes with automatic indexing disabled", () => {
    expect(AuditEvent.schema.options.autoIndex).toBe(false);
    expect(AuditEvent.schema.options.timestamps).toEqual({
      createdAt: true,
      updatedAt: false,
    });
    expect(AuditEvent.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ auditEventId: 1 }, { name: "uq_audit_event_id", unique: true }],
        [
          { "resource.type": 1, "resource.id": 1, occurredAt: -1 },
          { name: "idx_audit_resource_occurred_at" },
        ],
        [
          { correlationId: 1, occurredAt: -1 },
          { name: "idx_audit_correlation_occurred_at" },
        ],
        [
          { "actor.type": 1, "actor.id": 1, occurredAt: -1 },
          { name: "idx_audit_actor_occurred_at" },
        ],
        [
          { "idempotency.recordId": 1, occurredAt: -1 },
          { name: "idx_audit_idempotency_occurred_at" },
        ],
      ])
    );
    expect(
      AuditEvent.schema.indexes().some(([, options]) =>
        Object.prototype.hasOwnProperty.call(options, "expireAfterSeconds")
      )
    ).toBe(false);
  });

  it("validates exact snapshot hashes, byte sizes, strict fields, and no-change rules", async () => {
    await expect(new AuditEvent(buildRecord()).validate()).resolves.toBeUndefined();
    expect(() => new AuditEvent(buildRecord({ unknown: true }))).toThrow();
    const badEnvelope = buildSnapshotEnvelope(productSnapshot);
    badEnvelope.sizeBytes += 1;
    await expect(
      new AuditEvent(buildRecord({ after: badEnvelope })).validate()
    ).rejects.toThrow("does not match");
    const same = buildSnapshotEnvelope(productSnapshot);
    await expect(
      new AuditEvent(
        buildRecord({
          outcome: "no_change",
          before: same,
          after: same,
          reasonCode: "NO_STATE_CHANGE",
          metadata: {},
          metadataSizeBytes: 2,
        })
      ).validate()
    ).resolves.toBeUndefined();

    const unsafeSnapshot = buildSnapshotEnvelope({
      ...productSnapshot,
      password: "must-not-persist",
    });
    await expect(
      new AuditEvent(buildRecord({ after: unsafeSnapshot })).validate()
    ).rejects.toThrow("outside its allowlist");

    const unsafeMetadata = {
      eventType: "catalog.product.created",
      requestBody: { password: "must-not-persist" },
    };
    await expect(
      new AuditEvent(
        buildRecord({
          metadata: unsafeMetadata,
          metadataSizeBytes: Buffer.byteLength(
            require("../src/utils/canonicalJson").canonicalize(unsafeMetadata),
            "utf8"
          ),
        })
      ).validate()
    ).rejects.toThrow("unsupported fields");
  });

  it.each([
    ["UUID", { auditEventId: "not-a-uuid" }],
    ["schema version", { schemaVersion: 2 }],
    ["actor type", { actor: { type: "service", id: "actor" } }],
    ["actor bound", { actor: { type: "user", id: "x".repeat(129) } }],
    [
      "resource version",
      { resource: { type: "Product", id: productSnapshot.id, aggregateVersion: 0 } },
    ],
    ["resource type", { resource: { type: "User", id: "id", aggregateVersion: 1 } }],
    ["outcome", { outcome: "failed" }],
    ["context bound", { correlationId: "x".repeat(129) }],
    ["HTTP causation", { requestId: "request", causationId: "client" }],
    ["idempotency hash", { idempotency: { recordId: "id", keyHash: "bad" } }],
    ["occurredAt", { occurredAt: undefined }],
  ])("rejects invalid %s", async (label, override) => {
    await expect(new AuditEvent(buildRecord(override)).validate()).rejects.toThrow();
  });

  it("is append-only and enforces the exact UTF-8 snapshot boundary", async () => {
    const record = await AuditEvent.create(buildRecord());
    await expect(record.save()).rejects.toThrow("append-only");
    await expect(
      AuditEvent.updateOne({ _id: record._id }, { $set: { outcome: "no_change" } })
    ).rejects.toThrow("append-only");
    await expect(
      AuditEvent.updateOne(
        { _id: record._id },
        [{ $set: { requestId: "pipeline-tamper" } }],
        { updatePipeline: true }
      )
    ).rejects.toThrow("append-only");
    await expect(
      AuditEvent.bulkWrite([
        {
          updateOne: {
            filter: { _id: record._id },
            update: { $set: { requestId: "bulk-tamper" } },
          },
        },
      ])
    ).rejects.toThrow("append-only");
    await expect(AuditEvent.deleteOne({ _id: record._id })).rejects.toThrow(
      "append-only"
    );

    const emptySize = Buffer.byteLength('{"value":""}', "utf8");
    expect(
      serializeBoundedJson({
        value: { value: "é".repeat((16_384 - emptySize) / 2) },
        maxBytes: 16_384,
        tooLargeCode: errorCodes.AUDIT_SNAPSHOT_TOO_LARGE,
        tooLargeMessage: "too large",
      }).sizeBytes
    ).toBe(16_384);
    expect(() =>
      serializeBoundedJson({
        value: { value: `${"é".repeat((16_384 - emptySize) / 2)}x` },
        maxBytes: 16_384,
        tooLargeCode: errorCodes.AUDIT_SNAPSHOT_TOO_LARGE,
        tooLargeMessage: "too large",
      })
    ).toThrow(expect.objectContaining({ code: "AUDIT_SNAPSHOT_TOO_LARGE" }));

    expect(
      serializeBoundedJson({
        value: { value: "x".repeat(16_384 - emptySize) },
        maxBytes: 16_384,
        tooLargeCode: errorCodes.AUDIT_METADATA_TOO_LARGE,
        tooLargeMessage: "too large",
      }).sizeBytes
    ).toBe(16_384);
    expect(() =>
      serializeBoundedJson({
        value: { value: "x".repeat(16_385 - emptySize) },
        maxBytes: 16_384,
        tooLargeCode: errorCodes.AUDIT_METADATA_TOO_LARGE,
        tooLargeMessage: "too large",
      })
    ).toThrow(expect.objectContaining({ code: "AUDIT_METADATA_TOO_LARGE" }));
  });
});
