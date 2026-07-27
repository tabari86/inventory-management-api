const mongoose = require("mongoose");

const errorCodes = require("../errors/errorCodes");
const {
  EVENT_VERSION,
  MAX_OUTBOX_PAYLOAD_BYTES,
  PAYLOAD_SCHEMA_VERSION,
  getEventDefinition,
} = require("../services/domainEventRegistry");
const { canonicalize } = require("../utils/canonicalJson");
const { serializeBoundedJson } = require("../utils/boundedJson");

const OUTBOX_PRODUCER = "inventory-management-api";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const immutableString = (options = {}) => ({
  type: String,
  required: true,
  immutable: true,
  ...options,
});

const aggregateSchema = new mongoose.Schema(
  {
    type: immutableString({ enum: ["Product", "Warehouse", "Stock"] }),
    id: immutableString({ minlength: 1, maxlength: 128 }),
    version: {
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

const deliverySchema = new mongoose.Schema(
  {
    status: { type: String, required: true, enum: ["pending"] },
    attempts: { type: Number, required: true, enum: [0] },
    nextAttemptAt: { type: Date, required: true },
    lastAttemptAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 2_048 },
  },
  { _id: false, strict: "throw" }
);

const outboxEventSchema = new mongoose.Schema(
  {
    eventId: immutableString({ match: UUID_PATTERN }),
    eventType: immutableString({ maxlength: 160 }),
    eventVersion: {
      type: Number,
      required: true,
      immutable: true,
      enum: [EVENT_VERSION],
    },
    payloadSchemaVersion: {
      type: Number,
      required: true,
      immutable: true,
      enum: [PAYLOAD_SCHEMA_VERSION],
    },
    producer: immutableString({ enum: [OUTBOX_PRODUCER], maxlength: 64 }),
    aggregate: { type: aggregateSchema, required: true, immutable: true },
    occurredAt: { type: Date, required: true, immutable: true },
    requestId: immutableString({ minlength: 1, maxlength: 128 }),
    correlationId: immutableString({ minlength: 1, maxlength: 128 }),
    causationId: immutableString({ minlength: 1, maxlength: 128 }),
    source: immutableString({ enum: ["http-api"], maxlength: 32 }),
    idempotency: {
      type: idempotencySchema,
      default: null,
      immutable: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    payloadSizeBytes: {
      type: Number,
      required: true,
      immutable: true,
      min: 2,
      max: MAX_OUTBOX_PAYLOAD_BYTES,
      validate: Number.isInteger,
    },
    delivery: { type: deliverySchema, required: true },
  },
  {
    autoIndex: false,
    strict: "throw",
    timestamps: true,
  }
);

outboxEventSchema.pre("validate", function validatePayloadContract() {
  if (this.causationId !== this.requestId) {
    throw new Error("HTTP outbox causation must equal the request ID");
  }
  const definition = getEventDefinition(this.eventType);
  if (
    definition.eventVersion !== this.eventVersion ||
    definition.payloadSchemaVersion !== this.payloadSchemaVersion ||
    definition.aggregateType !== this.aggregate?.type
  ) {
    throw new Error("Outbox event registry contract does not match envelope");
  }
  const payload = definition.payloadBuilder(this.payload);
  const bounded = serializeBoundedJson({
    value: payload,
    maxBytes: MAX_OUTBOX_PAYLOAD_BYTES,
    tooLargeCode: errorCodes.OUTBOX_PAYLOAD_TOO_LARGE,
    tooLargeMessage: "Outbox payload exceeds the configured limit",
  });
  if (
    bounded.sizeBytes !== this.payloadSizeBytes ||
    canonicalize(payload) !== canonicalize(this.payload) ||
    payload.aggregateVersion !== this.aggregate?.version
  ) {
    throw new Error("Outbox payload does not match its envelope");
  }
  if (
    this.delivery?.status !== "pending" ||
    this.delivery?.attempts !== 0 ||
    this.delivery?.lastAttemptAt !== null ||
    this.delivery?.deliveredAt !== null ||
    this.delivery?.lastError !== null ||
    this.delivery?.nextAttemptAt?.getTime() !== this.occurredAt?.getTime()
  ) {
    throw new Error("Outbox delivery state must start immediately pending");
  }
});

const MUTABLE_OUTBOX_ROOTS = new Set(["delivery", "updatedAt"]);

const assertMutableOutboxPath = (path) => {
  const root = String(path).split(".")[0];
  if (!MUTABLE_OUTBOX_ROOTS.has(root)) {
    throw new Error("OutboxEvent envelope and payload are immutable");
  }
};

const validateOperatorPaths = (operator, value) => {
  if (operator === "$rename") {
    for (const [source, destination] of Object.entries(value || {})) {
      assertMutableOutboxPath(source);
      assertMutableOutboxPath(destination);
    }
    return;
  }
  if (operator === "$unset" && typeof value === "string") {
    assertMutableOutboxPath(value);
    return;
  }
  if (operator === "$unset" && Array.isArray(value)) {
    for (const path of value) assertMutableOutboxPath(path);
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OutboxEvent update shape is not supported");
  }
  for (const path of Object.keys(value)) assertMutableOutboxPath(path);
};

const validateOutboxUpdate = (update) => {
  if (!update || typeof update !== "object") return;
  if (Array.isArray(update)) {
    for (const stage of update) {
      const entries = Object.entries(stage || {});
      if (entries.length !== 1) {
        throw new Error("OutboxEvent update pipeline is not supported");
      }
      const [operator, value] = entries[0];
      if (!["$set", "$addFields", "$unset"].includes(operator)) {
        throw new Error("OutboxEvent update pipeline is not supported");
      }
      validateOperatorPaths(operator, value);
    }
    return;
  }

  for (const [operator, value] of Object.entries(update)) {
    if (!operator.startsWith("$")) {
      assertMutableOutboxPath(operator);
      continue;
    }
    validateOperatorPaths(operator, value);
  }
};

const protectOutboxEnvelope = function protectOutboxEnvelope() {
  validateOutboxUpdate(this.getUpdate());
};

outboxEventSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate"],
  protectOutboxEnvelope
);
outboxEventSchema.pre(
  ["replaceOne", "findOneAndReplace"],
  function blockOutboxReplacement() {
    throw new Error("OutboxEvent envelope and payload are immutable");
  }
);
outboxEventSchema.pre("bulkWrite", function protectOutboxBulkWrite(operations) {
  for (const operation of operations || []) {
    if (operation.updateOne) validateOutboxUpdate(operation.updateOne.update);
    if (operation.updateMany) validateOutboxUpdate(operation.updateMany.update);
    if (operation.replaceOne) {
      throw new Error("OutboxEvent envelope and payload are immutable");
    }
  }
});

outboxEventSchema.index(
  { eventId: 1 },
  { name: "uq_outbox_event_id", unique: true }
);
outboxEventSchema.index(
  { "aggregate.type": 1, "aggregate.id": 1, "aggregate.version": 1 },
  { name: "uq_outbox_aggregate_version", unique: true }
);
outboxEventSchema.index(
  { "delivery.status": 1, "delivery.nextAttemptAt": 1, createdAt: 1 },
  { name: "idx_outbox_delivery_pending" }
);
outboxEventSchema.index(
  { correlationId: 1, createdAt: 1 },
  { name: "idx_outbox_correlation_created_at" }
);

const OutboxEvent = mongoose.model("OutboxEvent", outboxEventSchema);

module.exports = OutboxEvent;
module.exports.MAX_OUTBOX_PAYLOAD_BYTES = MAX_OUTBOX_PAYLOAD_BYTES;
module.exports.OUTBOX_PRODUCER = OUTBOX_PRODUCER;
