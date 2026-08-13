const mongoose = require("mongoose");

const { REQUEST_HASH_VERSION } = require("../utils/canonicalJson");
const {
  ACTOR_TYPES,
  CONTEXT_ID_PATTERN,
  CONTEXT_SOURCES,
  isSupportedContextPair,
} = require("../utils/applicationContext");

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_IDEMPOTENCY_RESPONSE_BYTES = 1024 * 1024;
const IDEMPOTENCY_SCOPE_INDEX = "uq_idempotency_scope";
const IDEMPOTENCY_TTL_INDEX = "ttl_idempotency_expires_at";
const HASH_PATTERN = /^[a-f0-9]{64}$/;

const idempotencyRecordSchema = new mongoose.Schema(
  {
    actorType: {
      type: String,
      required: true,
      enum: Object.values(ACTOR_TYPES),
      maxlength: 16,
    },
    actorId: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 128,
      match: CONTEXT_ID_PATTERN,
    },
    operationId: {
      type: String,
      required: true,
      maxlength: 160,
    },
    keyHash: {
      type: String,
      required: true,
      match: HASH_PATTERN,
    },
    requestHash: {
      type: String,
      required: true,
      match: HASH_PATTERN,
    },
    requestHashVersion: {
      type: String,
      required: true,
      enum: [REQUEST_HASH_VERSION],
      maxlength: 32,
    },
    state: {
      type: String,
      required: true,
      enum: ["processing", "completed"],
    },
    originalRequestId: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 128,
      match: CONTEXT_ID_PATTERN,
    },
    originalCorrelationId: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 128,
      match: CONTEXT_ID_PATTERN,
    },
    source: {
      type: String,
      required: true,
      enum: Object.values(CONTEXT_SOURCES),
      maxlength: 32,
    },
    statusCode: {
      type: Number,
      min: 200,
      max: 299,
      validate: Number.isInteger,
    },
    responseBody: mongoose.Schema.Types.Mixed,
    responseSizeBytes: {
      type: Number,
      min: 0,
      max: MAX_IDEMPOTENCY_RESPONSE_BYTES,
      validate: Number.isInteger,
    },
    completedAt: Date,
    expiresAt: Date,
  },
  {
    autoIndex: false,
    strict: "throw",
    timestamps: true,
  }
);

idempotencyRecordSchema.pre("validate", function validateCompletedRecord() {
  if (!isSupportedContextPair(this.source, this.actorType)) {
    this.invalidate("source", "Unsupported application context pair");
  }

  if (this.state === "processing") {
    const session = this.$session();
    if (!session || !session.inTransaction()) {
      this.invalidate(
        "state",
        "Processing idempotency records must remain transaction-internal"
      );
    }
    return;
  }

  if (
    this.statusCode === undefined ||
    this.responseBody === undefined ||
    this.responseSizeBytes === undefined ||
    !this.completedAt ||
    !this.expiresAt
  ) {
    this.invalidate(
      "state",
      "Completed idempotency records require a response snapshot"
    );
  }
});

idempotencyRecordSchema.index(
  { actorType: 1, actorId: 1, operationId: 1, keyHash: 1 },
  { unique: true, name: IDEMPOTENCY_SCOPE_INDEX }
);
idempotencyRecordSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: IDEMPOTENCY_TTL_INDEX }
);

const IdempotencyRecord = mongoose.model(
  "IdempotencyRecord",
  idempotencyRecordSchema
);

module.exports = IdempotencyRecord;
module.exports.HASH_PATTERN = HASH_PATTERN;
module.exports.IDEMPOTENCY_RETENTION_MS = IDEMPOTENCY_RETENTION_MS;
module.exports.IDEMPOTENCY_SCOPE_INDEX = IDEMPOTENCY_SCOPE_INDEX;
module.exports.IDEMPOTENCY_TTL_INDEX = IDEMPOTENCY_TTL_INDEX;
module.exports.MAX_IDEMPOTENCY_RESPONSE_BYTES = MAX_IDEMPOTENCY_RESPONSE_BYTES;
