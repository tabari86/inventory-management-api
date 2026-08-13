const { randomUUID } = require("crypto");

const AuditEvent = require("../models/AuditEvent");
const OutboxEvent = require("../models/OutboxEvent");
const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const { mutationOperationRegistry } = require("./inventoryOperationRegistry");
const { getEventDefinition } = require("./domainEventRegistry");
const { snapshotBuilders } = require("./eventSnapshots");
const { sha256 } = require("../utils/idempotencyHash");
const { serializeBoundedJson } = require("../utils/boundedJson");
const { assertApplicationContext } = require("../utils/applicationContext");

const {
  AUDIT_SCHEMA_VERSION,
  MAX_AUDIT_METADATA_BYTES,
  MAX_AUDIT_SNAPSHOT_BYTES,
} = AuditEvent;
const { MAX_OUTBOX_PAYLOAD_BYTES, OUTBOX_PRODUCER } = OutboxEvent;
const operationIds = new Set(
  mutationOperationRegistry.map(({ operationId }) => operationId)
);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const invalid = (message, cause) =>
  new DomainError({
    code: errorCodes.EVENT_DESCRIPTOR_INVALID,
    httpStatus: 500,
    message,
    safeMessage: "Could not complete request",
    retryable: false,
    cause,
  });

const validateContext = ({ context, operationId, idempotency, session }) => {
  try {
    assertApplicationContext(context);
  } catch (cause) {
    throw invalid("Invalid application context for event persistence", cause);
  }
  if (!operationIds.has(operationId)) {
    throw invalid("Invalid Inventory operation ID for event persistence");
  }
  if (
    !session ||
    typeof session.inTransaction !== "function" ||
    !session.inTransaction()
  ) {
    throw invalid("Event persistence requires the active mutation transaction");
  }
  if (
    idempotency !== null &&
    (!idempotency ||
      typeof idempotency.recordId !== "string" ||
      !idempotency.recordId ||
      !SHA256_PATTERN.test(idempotency.keyHash))
  ) {
    throw invalid("Invalid idempotency event reference");
  }
};

const buildSnapshotEnvelope = (snapshot) => {
  if (snapshot === null) return null;
  const bounded = serializeBoundedJson({
    value: snapshot,
    maxBytes: MAX_AUDIT_SNAPSHOT_BYTES,
    tooLargeCode: errorCodes.AUDIT_SNAPSHOT_TOO_LARGE,
    tooLargeMessage: "Audit snapshot exceeds the configured limit",
  });
  return {
    hash: sha256(bounded.serialized),
    hashVersion: "canonical-json-v1",
    snapshot: bounded.value,
    sizeBytes: bounded.sizeBytes,
  };
};

const buildMetadata = (descriptor) => {
  const metadata = {};
  for (const [key, value] of Object.entries(descriptor.metadata || {})) {
    metadata[key] = value;
  }
  if (descriptor.kind === "changed") metadata.eventType = descriptor.eventType;
  const bounded = serializeBoundedJson({
    value: metadata,
    maxBytes: MAX_AUDIT_METADATA_BYTES,
    tooLargeCode: errorCodes.AUDIT_METADATA_TOO_LARGE,
    tooLargeMessage: "Audit metadata exceeds the configured limit",
  });
  return { metadata: bounded.value, metadataSizeBytes: bounded.sizeBytes };
};

const assertAggregatePayloadIdentity = ({ descriptor, payload }) => {
  const idField = {
    Product: "productId",
    Warehouse: "warehouseId",
    Stock: "stockId",
  }[descriptor.aggregateType];
  if (
    payload[idField] !== descriptor.aggregateId ||
    payload.aggregateVersion !== descriptor.aggregateVersion
  ) {
    throw invalid("Event payload aggregate identity does not match descriptor");
  }
};

const prepareRecords = ({
  descriptors,
  context,
  operationId,
  idempotency,
  resolveEventDefinition = getEventDefinition,
}) => {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    throw invalid("A successful Inventory mutation requires event descriptors");
  }

  const auditRecords = [];
  const outboxRecords = [];
  const changedVersions = new Set();

  for (const descriptor of descriptors) {
    if (!descriptor || !["changed", "no_change"].includes(descriptor.kind)) {
      throw invalid("Invalid event descriptor kind");
    }

    const snapshotBuilder = snapshotBuilders[descriptor.aggregateType];
    if (!snapshotBuilder) {
      throw invalid("Invalid event descriptor aggregate type");
    }
    const before = buildSnapshotEnvelope(
      descriptor.before === null ? null : snapshotBuilder(descriptor.before)
    );
    const after = buildSnapshotEnvelope(
      descriptor.after === null ? null : snapshotBuilder(descriptor.after)
    );
    const { metadata, metadataSizeBytes } = buildMetadata(descriptor);
    const occurredAt = new Date(descriptor.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw invalid("Invalid event descriptor occurrence time");
    }

    if (
      descriptor.kind === "no_change" &&
      (!before ||
        !after ||
        before.hash !== after.hash ||
        descriptor.reasonCode !== "NO_STATE_CHANGE")
    ) {
      throw invalid("No-change descriptor snapshots must be equivalent");
    }

    auditRecords.push({
      auditEventId: randomUUID(),
      schemaVersion: AUDIT_SCHEMA_VERSION,
      actor: { type: context.actor.type, id: context.actor.id },
      action: operationId,
      resource: {
        type: descriptor.aggregateType,
        id: descriptor.aggregateId,
        aggregateVersion: descriptor.aggregateVersion,
      },
      outcome: descriptor.kind === "changed" ? "succeeded" : "no_change",
      requestId: context.requestId,
      correlationId: context.correlationId,
      causationId: context.causationId,
      source: context.source,
      idempotency,
      before,
      after,
      reasonCode: descriptor.reasonCode ?? null,
      metadata,
      metadataSizeBytes,
      occurredAt,
    });

    if (descriptor.kind === "no_change") continue;

    const definition = resolveEventDefinition(descriptor.eventType);
    if (definition.aggregateType !== descriptor.aggregateType) {
      throw invalid("Event type aggregate does not match descriptor");
    }
    const versionIdentity = [
      descriptor.aggregateType,
      descriptor.aggregateId,
      descriptor.aggregateVersion,
    ].join(":");
    if (changedVersions.has(versionIdentity)) {
      throw invalid("Duplicate aggregate-version event descriptor");
    }
    changedVersions.add(versionIdentity);

    const payload = definition.payloadBuilder(descriptor.payload);
    assertAggregatePayloadIdentity({ descriptor, payload });
    const boundedPayload = serializeBoundedJson({
      value: payload,
      maxBytes: Math.min(
        definition.maxPayloadBytes,
        MAX_OUTBOX_PAYLOAD_BYTES
      ),
      tooLargeCode: errorCodes.OUTBOX_PAYLOAD_TOO_LARGE,
      tooLargeMessage: "Outbox payload exceeds the configured limit",
    });

    outboxRecords.push({
      eventId: randomUUID(),
      eventType: definition.eventType,
      eventVersion: definition.eventVersion,
      payloadSchemaVersion: definition.payloadSchemaVersion,
      producer: OUTBOX_PRODUCER,
      aggregate: {
        type: descriptor.aggregateType,
        id: descriptor.aggregateId,
        version: descriptor.aggregateVersion,
      },
      occurredAt,
      requestId: context.requestId,
      correlationId: context.correlationId,
      causationId: context.causationId,
      source: context.source,
      idempotency,
      payload: boundedPayload.value,
      payloadSizeBytes: boundedPayload.sizeBytes,
      delivery: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: occurredAt,
        lastAttemptAt: null,
        deliveredAt: null,
        lastError: null,
      },
    });
  }

  return { auditRecords, outboxRecords };
};

const persistAuditOutboxEvents = async ({
  descriptors,
  context,
  operationId,
  idempotency = null,
  session,
  models = {},
  resolveEventDefinition = getEventDefinition,
}) => {
  validateContext({ context, operationId, idempotency, session });
  const { auditRecords, outboxRecords } = prepareRecords({
    descriptors,
    context,
    operationId,
    idempotency,
    resolveEventDefinition,
  });

  const AuditModel = models.AuditEvent || AuditEvent;
  const OutboxModel = models.OutboxEvent || OutboxEvent;
  const auditDocuments = auditRecords.map((record) => new AuditModel(record));
  const outboxDocuments = outboxRecords.map((record) => new OutboxModel(record));

  for (const document of auditDocuments) await document.validate();
  for (const document of outboxDocuments) await document.validate();

  await AuditModel.insertMany(auditRecords, { session, ordered: true });
  if (outboxRecords.length > 0) {
    await OutboxModel.insertMany(outboxRecords, { session, ordered: true });
  }

  return {
    auditCount: auditRecords.length,
    outboxCount: outboxRecords.length,
    auditEventIds: auditRecords.map(({ auditEventId }) => auditEventId),
    outboxEventIds: outboxRecords.map(({ eventId }) => eventId),
  };
};

module.exports = {
  buildSnapshotEnvelope,
  persistAuditOutboxEvents,
  prepareRecords,
  validateContext,
};
