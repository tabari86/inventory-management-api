const mongoose = require("mongoose");

const errorCodes = require("../errors/errorCodes");
const {
  mutationOperationRegistry,
} = require("../services/inventoryOperationRegistry");
const { getEventDefinition } = require("../services/domainEventRegistry");
const { snapshotBuilders } = require("../services/eventSnapshots");
const { canonicalize } = require("../utils/canonicalJson");
const { sha256 } = require("../utils/idempotencyHash");
const { serializeBoundedJson } = require("../utils/boundedJson");
const {
  ACTOR_TYPES,
  CONTEXT_ID_PATTERN,
  CONTEXT_SOURCES,
  isSupportedContextPair,
} = require("../utils/applicationContext");

const AUDIT_SCHEMA_VERSION = 1;
const MAX_AUDIT_SNAPSHOT_BYTES = 16_384;
const MAX_AUDIT_METADATA_BYTES = 16_384;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operationIds = mutationOperationRegistry.map(
  ({ operationId }) => operationId
);
const COMMON_CHANGED_METADATA_FIELDS = Object.freeze([
  "eventType",
  "bulkItemIndex",
]);
const EVENT_METADATA_FIELDS = Object.freeze({
  "catalog.product.stock-linked": Object.freeze([
    "linkedStockIds",
    "linkedStockCount",
  ]),
  "warehouse.stock-linked": Object.freeze([
    "linkedStockIds",
    "linkedStockCount",
  ]),
  "inventory.stock.availability-guard-changed": Object.freeze([
    "causeAggregateType",
    "causeAggregateId",
  ]),
  "inventory.stock.received": Object.freeze([
    "stockMovementId",
    "movementType",
    "signedQuantityDelta",
    "reference",
  ]),
  "inventory.stock.issued": Object.freeze([
    "stockMovementId",
    "movementType",
    "signedQuantityDelta",
    "reference",
  ]),
});

const immutableString = (options = {}) => ({
  type: String,
  required: true,
  immutable: true,
  ...options,
});

const actorSchema = new mongoose.Schema(
  {
    type: immutableString({ enum: Object.values(ACTOR_TYPES), maxlength: 16 }),
    id: immutableString({
      minlength: 1,
      maxlength: 128,
      match: CONTEXT_ID_PATTERN,
    }),
  },
  { _id: false, strict: "throw" }
);

const resourceSchema = new mongoose.Schema(
  {
    type: immutableString({ enum: ["Product", "Warehouse", "Stock"] }),
    id: immutableString({ minlength: 1, maxlength: 128 }),
    aggregateVersion: {
      type: Number,
      required: true,
      immutable: true,
      min: 1,
      validate: Number.isInteger,
    },
  },
  { _id: false, strict: "throw" }
);

const idempotencySchema = new mongoose.Schema(
  {
    recordId: immutableString({ minlength: 1, maxlength: 128 }),
    keyHash: immutableString({ match: HASH_PATTERN }),
  },
  { _id: false, strict: "throw" }
);

const snapshotEnvelopeSchema = new mongoose.Schema(
  {
    hash: immutableString({ match: HASH_PATTERN }),
    hashVersion: immutableString({ enum: ["canonical-json-v1"] }),
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
      immutable: true,
      min: 0,
      max: MAX_AUDIT_SNAPSHOT_BYTES,
      validate: Number.isInteger,
    },
  },
  { _id: false, strict: "throw" }
);

const auditEventSchema = new mongoose.Schema(
  {
    auditEventId: immutableString({ match: UUID_PATTERN }),
    schemaVersion: {
      type: Number,
      required: true,
      immutable: true,
      enum: [AUDIT_SCHEMA_VERSION],
    },
    actor: { type: actorSchema, required: true, immutable: true },
    action: immutableString({ enum: operationIds, maxlength: 160 }),
    resource: { type: resourceSchema, required: true, immutable: true },
    outcome: immutableString({ enum: ["succeeded", "no_change"] }),
    requestId: immutableString({
      minlength: 1,
      maxlength: 128,
      match: CONTEXT_ID_PATTERN,
    }),
    correlationId: immutableString({
      minlength: 1,
      maxlength: 128,
      match: CONTEXT_ID_PATTERN,
    }),
    causationId: immutableString({
      minlength: 1,
      maxlength: 128,
      match: CONTEXT_ID_PATTERN,
    }),
    source: immutableString({
      enum: Object.values(CONTEXT_SOURCES),
      maxlength: 32,
    }),
    idempotency: {
      type: idempotencySchema,
      default: null,
      immutable: true,
    },
    before: {
      type: snapshotEnvelopeSchema,
      default: null,
      immutable: true,
    },
    after: {
      type: snapshotEnvelopeSchema,
      default: null,
      immutable: true,
    },
    reasonCode: {
      type: String,
      default: null,
      immutable: true,
      maxlength: 128,
      match: /^[A-Z0-9_:-]+$/,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
      default: () => ({}),
    },
    metadataSizeBytes: {
      type: Number,
      required: true,
      immutable: true,
      min: 2,
      max: MAX_AUDIT_METADATA_BYTES,
      validate: Number.isInteger,
    },
    occurredAt: { type: Date, required: true, immutable: true },
  },
  {
    autoIndex: false,
    strict: "throw",
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const validateSnapshotEnvelope = (envelope, resourceType) => {
  if (envelope === null || envelope === undefined) return;
  const bounded = serializeBoundedJson({
    value: envelope.snapshot,
    maxBytes: MAX_AUDIT_SNAPSHOT_BYTES,
    tooLargeCode: errorCodes.AUDIT_SNAPSHOT_TOO_LARGE,
    tooLargeMessage: "Audit snapshot exceeds the configured limit",
  });
  const snapshotBuilder = snapshotBuilders[resourceType];
  if (
    !snapshotBuilder ||
    canonicalize(snapshotBuilder(bounded.value)) !== bounded.serialized
  ) {
    throw new Error("Audit snapshot contains fields outside its allowlist");
  }
  if (
    envelope.sizeBytes !== bounded.sizeBytes ||
    envelope.hashVersion !== "canonical-json-v1" ||
    envelope.hash !== sha256(bounded.serialized)
  ) {
    throw new Error("Audit snapshot envelope does not match its snapshot");
  }
};

const validateBulkItemIndex = (value) =>
  value === undefined ||
  (Number.isInteger(value) && value >= 0 && value < 150);

const validateCanonicalIds = (values) =>
  Array.isArray(values) &&
  values.length >= 1 &&
  values.length <= 150 &&
  values.every(
    (value) => typeof value === "string" && value.length >= 1 && value.length <= 128
  ) &&
  new Set(values).size === values.length &&
  [...values].sort().join("\0") === values.join("\0");

const validateAuditMetadata = ({ metadata, outcome, resourceType }) => {
  if (!metadata || Array.isArray(metadata)) {
    throw new Error("Audit metadata must be a plain object");
  }

  if (!validateBulkItemIndex(metadata.bulkItemIndex)) {
    throw new Error("Audit metadata has an invalid bulk item index");
  }

  if (outcome === "no_change") {
    const allowed = new Set(["bulkItemIndex"]);
    if (Object.keys(metadata).some((field) => !allowed.has(field))) {
      throw new Error("No-change audit metadata contains unsupported fields");
    }
    return;
  }

  const definition = getEventDefinition(metadata.eventType);
  if (definition.aggregateType !== resourceType) {
    throw new Error("Audit metadata event type does not match its resource");
  }
  const eventFields = EVENT_METADATA_FIELDS[metadata.eventType] || [];
  const allowed = new Set([...COMMON_CHANGED_METADATA_FIELDS, ...eventFields]);
  if (Object.keys(metadata).some((field) => !allowed.has(field))) {
    throw new Error("Audit metadata contains unsupported fields");
  }

  if (eventFields.includes("linkedStockIds")) {
    if (
      !validateCanonicalIds(metadata.linkedStockIds) ||
      metadata.linkedStockCount !== metadata.linkedStockIds.length
    ) {
      throw new Error("Audit link metadata is invalid");
    }
  }

  if (eventFields.includes("causeAggregateType")) {
    if (
      !["Product", "Warehouse"].includes(metadata.causeAggregateType) ||
      typeof metadata.causeAggregateId !== "string" ||
      metadata.causeAggregateId.length < 1 ||
      metadata.causeAggregateId.length > 128
    ) {
      throw new Error("Audit cause metadata is invalid");
    }
  }

  if (eventFields.includes("stockMovementId")) {
    const receipt = metadata.eventType === "inventory.stock.received";
    if (
      typeof metadata.stockMovementId !== "string" ||
      metadata.stockMovementId.length < 1 ||
      metadata.stockMovementId.length > 128 ||
      metadata.movementType !== (receipt ? "GOODS_RECEIPT" : "GOODS_ISSUE") ||
      !Number.isInteger(metadata.signedQuantityDelta) ||
      (receipt
        ? metadata.signedQuantityDelta <= 0
        : metadata.signedQuantityDelta >= 0) ||
      (metadata.reference !== undefined &&
        (typeof metadata.reference !== "string" ||
          metadata.reference.length > 100))
    ) {
      throw new Error("Audit movement metadata is invalid");
    }
  }
};

auditEventSchema.pre("validate", function validateBoundedFields() {
  if (!isSupportedContextPair(this.source, this.actor?.type)) {
    throw new Error("Unsupported application context pair");
  }
  if (this.causationId !== this.requestId) {
    throw new Error("Audit causation must equal the request ID");
  }
  validateSnapshotEnvelope(this.before, this.resource?.type);
  validateSnapshotEnvelope(this.after, this.resource?.type);
  const metadata = serializeBoundedJson({
    value: this.metadata,
    maxBytes: MAX_AUDIT_METADATA_BYTES,
    tooLargeCode: errorCodes.AUDIT_METADATA_TOO_LARGE,
    tooLargeMessage: "Audit metadata exceeds the configured limit",
  });
  validateAuditMetadata({
    metadata: metadata.value,
    outcome: this.outcome,
    resourceType: this.resource?.type,
  });
  if (metadata.sizeBytes !== this.metadataSizeBytes) {
    throw new Error("Audit metadata size does not match metadata");
  }
  if (
    this.outcome === "no_change" &&
    (!this.before ||
      !this.after ||
      this.before.hash !== this.after.hash ||
      this.reasonCode !== "NO_STATE_CHANGE")
  ) {
    throw new Error("No-change audit events require equivalent snapshots");
  }
});

const blockAuditMutation = function blockAuditMutation() {
  throw new Error("AuditEvent records are append-only");
};
auditEventSchema.pre("save", function blockExistingAuditSave() {
  if (!this.isNew) blockAuditMutation();
});
auditEventSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findOneAndReplace",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  blockAuditMutation
);
auditEventSchema.pre(
  "deleteOne",
  { document: true, query: false },
  blockAuditMutation
);
auditEventSchema.pre("bulkWrite", blockAuditMutation);

auditEventSchema.index(
  { auditEventId: 1 },
  { name: "uq_audit_event_id", unique: true }
);
auditEventSchema.index(
  { "resource.type": 1, "resource.id": 1, occurredAt: -1 },
  { name: "idx_audit_resource_occurred_at" }
);
auditEventSchema.index(
  { correlationId: 1, occurredAt: -1 },
  { name: "idx_audit_correlation_occurred_at" }
);
auditEventSchema.index(
  { "actor.type": 1, "actor.id": 1, occurredAt: -1 },
  { name: "idx_audit_actor_occurred_at" }
);
auditEventSchema.index(
  { "idempotency.recordId": 1, occurredAt: -1 },
  { name: "idx_audit_idempotency_occurred_at" }
);

const AuditEvent = mongoose.model("AuditEvent", auditEventSchema);

module.exports = AuditEvent;
module.exports.AUDIT_SCHEMA_VERSION = AUDIT_SCHEMA_VERSION;
module.exports.MAX_AUDIT_METADATA_BYTES = MAX_AUDIT_METADATA_BYTES;
module.exports.MAX_AUDIT_SNAPSHOT_BYTES = MAX_AUDIT_SNAPSHOT_BYTES;
