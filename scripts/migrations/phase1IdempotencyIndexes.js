const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const COLLECTION_NAME = "idempotencyrecords";
const UNIQUE_INDEX_NAME = "uq_idempotency_scope";
const TTL_INDEX_NAME = "ttl_idempotency_expires_at";
const UNIQUE_INDEX_KEY = Object.freeze({
  actorType: 1,
  actorId: 1,
  operationId: 1,
  keyHash: 1,
});
const TTL_INDEX_KEY = Object.freeze({ expiresAt: 1 });
const PROCESSING_RECORD_SAMPLE_LIMIT = 50;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const COMPLETION_EVIDENCE_FIELDS = Object.freeze([
  "statusCode",
  "responseBody",
  "responseSizeBytes",
  "completedAt",
]);
const CLI_USAGE =
  "Usage: npm run migrate:phase1-idempotency [-- --apply | -- --repair-processing <recordId>]";

const hasExactOrderedKey = (actual = {}, expected) => {
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([field, direction], index) =>
        field === expectedEntries[index][0] &&
        direction === expectedEntries[index][1]
    )
  );
};

const hasSameFields = (actual = {}, expected) => {
  const actualFields = Object.keys(actual).sort();
  const expectedFields = Object.keys(expected).sort();
  return (
    actualFields.length === expectedFields.length &&
    actualFields.every((field, index) => field === expectedFields[index])
  );
};

const hasCompatibleCollation = (index) =>
  index.collation === undefined || index.collation?.locale === "simple";

const isEquivalentUniqueIndex = (index) =>
  hasExactOrderedKey(index.key, UNIQUE_INDEX_KEY) &&
  index.unique === true &&
  index.prepareUnique !== true &&
  index.sparse !== true &&
  index.partialFilterExpression === undefined &&
  hasCompatibleCollation(index);

const isEquivalentTtlIndex = (index) =>
  hasExactOrderedKey(index.key, TTL_INDEX_KEY) &&
  index.expireAfterSeconds === 0 &&
  index.unique !== true &&
  index.prepareUnique !== true &&
  index.sparse !== true &&
  index.partialFilterExpression === undefined &&
  hasCompatibleCollation(index);

const classifyRequiredIndex = ({
  indexes,
  expectedName,
  expectedKey,
  isEquivalent,
  isRelated,
}) => {
  const incompatible = indexes.find(
    (index) =>
      (index.name === expectedName ||
        hasSameFields(index.key, expectedKey) ||
        isRelated(index)) &&
      !isEquivalent(index)
  );

  if (incompatible) {
    return {
      state: "incompatible",
      existingName: incompatible.name,
    };
  }

  const equivalent = indexes.find(isEquivalent);
  if (equivalent) {
    return {
      state: "present",
      existingName: equivalent.name,
    };
  }

  return { state: "absent", existingName: null };
};

const classifyIndexes = (indexes) => ({
  unique: classifyRequiredIndex({
    indexes,
    expectedName: UNIQUE_INDEX_NAME,
    expectedKey: UNIQUE_INDEX_KEY,
    isEquivalent: isEquivalentUniqueIndex,
    isRelated: (index) =>
      Object.keys(UNIQUE_INDEX_KEY).some((field) =>
        Object.prototype.hasOwnProperty.call(index.key || {}, field)
      ) &&
      Object.keys(index.key || {}).some((field) =>
        Object.prototype.hasOwnProperty.call(UNIQUE_INDEX_KEY, field)
      ) &&
      hasSameFields(
        Object.fromEntries(
          Object.keys(index.key || {})
            .filter((field) =>
              Object.prototype.hasOwnProperty.call(UNIQUE_INDEX_KEY, field)
            )
            .map((field) => [field, index.key[field]])
        ),
        UNIQUE_INDEX_KEY
      ),
  }),
  ttl: classifyRequiredIndex({
    indexes,
    expectedName: TTL_INDEX_NAME,
    expectedKey: TTL_INDEX_KEY,
    isEquivalent: isEquivalentTtlIndex,
    isRelated: (index) =>
      Object.prototype.hasOwnProperty.call(index.key || {}, "expiresAt"),
  }),
});

const parseMigrationArgs = (args) => {
  if (!Array.isArray(args)) {
    const error = new Error("Invalid migration arguments");
    error.code = "INVALID_MIGRATION_ARGS";
    throw error;
  }

  if (args.length === 0) return { mode: "dry-run", apply: false };
  if (args.length === 1 && args[0] === "--apply") {
    return { mode: "apply", apply: true };
  }
  if (
    args.length === 2 &&
    args[0] === "--repair-processing" &&
    typeof args[1] === "string" &&
    OBJECT_ID_PATTERN.test(args[1])
  ) {
    return {
      mode: "repair-processing",
      apply: false,
      repairProcessingRecordId: args[1].toLowerCase(),
    };
  }

  const error = new Error("Invalid migration arguments");
  error.code = "INVALID_MIGRATION_ARGS";
  throw error;
};

const formatCliError = (error) =>
  error?.code === "INVALID_MIGRATION_ARGS"
    ? CLI_USAGE
    : "Idempotency index migration failed. Review safe migration diagnostics.";

const collectionExists = async (db) => {
  const collections = await db
    .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
    .toArray();
  return collections.length === 1;
};

const inspectIndexes = async (db, exists) => {
  if (!exists) return [];
  try {
    return await db.collection(COLLECTION_NAME).listIndexes().toArray();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound" || error.code === 26) return [];
    throw error;
  }
};

const countDuplicateScopes = async (db, exists) => {
  if (!exists) return 0;

  const duplicates = await db
    .collection(COLLECTION_NAME)
    .aggregate([
      {
        $match: {
          actorType: { $type: "string" },
          actorId: { $type: "string" },
          operationId: { $type: "string" },
          keyHash: { $type: "string", $regex: /^[a-f0-9]{64}$/ },
        },
      },
      {
        $group: {
          _id: {
            actorType: "$actorType",
            actorId: "$actorId",
            operationId: "$operationId",
            keyHash: "$keyHash",
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $count: "count" },
    ])
    .toArray();

  return duplicates[0]?.count || 0;
};

const isTtlUsableDate = (value) =>
  value instanceof Date ||
  (Array.isArray(value) && value.some((item) => item instanceof Date));

const getBsonType = (value) => {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (typeof value === "number") return "double";
  return typeof value;
};

const toSafeProcessingDiagnostic = (record) => {
  const expiresAtType = getBsonType(record.expiresAt);
  const expiresAtTtlUsable = isTtlUsableDate(record.expiresAt);
  let expiresAtState = "non-expiring";

  if (expiresAtType === "missing") expiresAtState = "absent";
  else if (expiresAtType === "null") expiresAtState = "null";
  else if (expiresAtTtlUsable) expiresAtState = "ttl-usable";

  return {
    recordId:
      record._id?._bsontype === "ObjectId" ? record._id.toHexString() : null,
    operationId:
      typeof record.operationId === "string"
        ? record.operationId.slice(0, 160)
        : null,
    state: "processing",
    createdAt: record.createdAt instanceof Date ? record.createdAt : null,
    expiresAtState,
    expiresAtType,
    expiresAtTtlUsable,
  };
};

const inspectProcessingRecords = async (db, exists) => {
  if (!exists) {
    return {
      processingRecordCount: 0,
      nonExpiringProcessingCount: 0,
      processingRecordSample: [],
    };
  }

  const collection = db.collection(COLLECTION_NAME);
  const processingFilter = { state: "processing" };
  const nonExpiringFilter = {
    ...processingFilter,
    expiresAt: { $not: { $type: "date" } },
  };
  const [processingRecordCount, nonExpiringProcessingCount, sample] =
    await Promise.all([
      collection.countDocuments(processingFilter),
      collection.countDocuments(nonExpiringFilter),
      collection
        .find(processingFilter, {
          projection: {
            _id: 1,
            operationId: 1,
            state: 1,
            createdAt: 1,
            expiresAt: 1,
          },
        })
        .sort({ _id: 1 })
        .limit(PROCESSING_RECORD_SAMPLE_LIMIT)
        .toArray(),
    ]);

  return {
    processingRecordCount,
    nonExpiringProcessingCount,
    processingRecordSample: sample.map(toSafeProcessingDiagnostic),
  };
};

const hasCompletionEvidence = (record) =>
  COMPLETION_EVIDENCE_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(record, field)
  );

const repairProcessingRecord = async ({ db, recordId }) => {
  if (typeof recordId !== "string" || !OBJECT_ID_PATTERN.test(recordId)) {
    throw new Error("Invalid idempotency processing repair record ID");
  }

  const normalizedRecordId = recordId.toLowerCase();
  const objectId = new mongoose.Types.ObjectId(normalizedRecordId);
  const collection = db.collection(COLLECTION_NAME);
  const target = await collection.findOne(
    { _id: objectId },
    {
      projection: {
        state: 1,
        expiresAt: 1,
        statusCode: 1,
        responseBody: 1,
        responseSizeBytes: 1,
        completedAt: 1,
      },
    }
  );

  if (!target) {
    throw new Error("Idempotency processing repair target was not found");
  }
  if (target.state !== "processing") {
    throw new Error(
      "Idempotency processing repair target is not in processing state"
    );
  }
  if (isTtlUsableDate(target.expiresAt)) {
    throw new Error(
      "Idempotency processing repair target can expire through TTL"
    );
  }
  if (hasCompletionEvidence(target)) {
    throw new Error(
      "Idempotency processing repair target has completion evidence"
    );
  }

  const evidenceFilter = { "idempotency.recordId": normalizedRecordId };
  const linkedAudit = await db
    .collection("auditevents")
    .findOne(evidenceFilter, { projection: { _id: 1 } });
  if (linkedAudit) {
    throw new Error(
      "Idempotency processing repair target has linked AuditEvent evidence"
    );
  }

  const linkedOutbox = await db
    .collection("outboxevents")
    .findOne(evidenceFilter, { projection: { _id: 1 } });
  if (linkedOutbox) {
    throw new Error(
      "Idempotency processing repair target has linked OutboxEvent evidence"
    );
  }

  const completionEvidenceAbsent = Object.fromEntries(
    COMPLETION_EVIDENCE_FIELDS.map((field) => [field, { $exists: false }])
  );
  const result = await collection.deleteOne({
    _id: objectId,
    state: "processing",
    expiresAt: { $not: { $type: "date" } },
    ...completionEvidenceAbsent,
  });

  if (result.deletedCount !== 1) {
    throw new Error(
      "Idempotency processing repair target changed; no record was deleted"
    );
  }

  return {
    mode: "repair-processing",
    database: db.databaseName,
    recordId: normalizedRecordId,
    deletedCount: 1,
  };
};

const migrateDatabase = async ({
  db,
  apply = false,
  repairProcessingRecordId = null,
}) => {
  if (apply && repairProcessingRecordId !== null) {
    throw new Error(
      "Idempotency processing repair cannot run during index apply"
    );
  }
  if (repairProcessingRecordId !== null) {
    return repairProcessingRecord({ db, recordId: repairProcessingRecordId });
  }

  const exists = await collectionExists(db);
  const indexes = await inspectIndexes(db, exists);
  const inspection = classifyIndexes(indexes);
  const duplicateScopeCount = await countDuplicateScopes(db, exists);
  const processingInspection = await inspectProcessingRecords(db, exists);
  const summary = {
    mode: apply ? "apply" : "dry-run",
    database: db.databaseName,
    collectionExists: exists,
    duplicateScopeCount,
    ...processingInspection,
    indexes: {
      unique: {
        name: UNIQUE_INDEX_NAME,
        existingName: inspection.unique.existingName,
        alreadyPresent: inspection.unique.state === "present",
        wouldCreate: inspection.unique.state === "absent",
        created: false,
        incompatible: inspection.unique.state === "incompatible",
      },
      ttl: {
        name: TTL_INDEX_NAME,
        existingName: inspection.ttl.existingName,
        alreadyPresent: inspection.ttl.state === "present",
        wouldCreate: inspection.ttl.state === "absent",
        created: false,
        incompatible: inspection.ttl.state === "incompatible",
      },
    },
  };

  if (
    inspection.unique.state === "incompatible" ||
    inspection.ttl.state === "incompatible"
  ) {
    const error = new Error("Incompatible idempotency index blocks migration");
    error.migrationSummary = summary;
    throw error;
  }

  if (!apply) return summary;

  if (processingInspection.nonExpiringProcessingCount > 0) {
    const error = new Error(
      "Non-expiring processing idempotency records block safe migration"
    );
    error.migrationSummary = summary;
    throw error;
  }

  if (duplicateScopeCount > 0) {
    const error = new Error(
      "Duplicate idempotency scopes block safe unique-index creation"
    );
    error.migrationSummary = summary;
    throw error;
  }

  const collection = db.collection(COLLECTION_NAME);

  if (inspection.unique.state === "absent") {
    await collection.createIndex(UNIQUE_INDEX_KEY, {
      name: UNIQUE_INDEX_NAME,
      unique: true,
    });
    summary.indexes.unique.created = true;
  }

  if (inspection.ttl.state === "absent") {
    await collection.createIndex(TTL_INDEX_KEY, {
      name: TTL_INDEX_NAME,
      expireAfterSeconds: 0,
    });
    summary.indexes.ttl.created = true;
  }

  return summary;
};

const runMigration = async ({
  uri = process.env.MONGODB_URI,
  apply = false,
  repairProcessingRecordId = null,
  logger = console,
  createConnection = (connectionUri) =>
    mongoose.createConnection(connectionUri).asPromise(),
} = {}) => {
  if (!uri) throw new Error("MONGODB_URI is required");

  let connection;
  let result;
  let primaryError;
  let cleanupError;

  try {
    connection = await createConnection(uri);
    result = await migrateDatabase({
      db: connection.db,
      apply,
      repairProcessingRecordId,
    });
  } catch (error) {
    primaryError = error;
  }

  if (connection) {
    try {
      await connection.close();
    } catch (error) {
      cleanupError = error;
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;

  logger.log(JSON.stringify(result, null, 2));
  return result;
};

const runMigrationCli = async ({
  args = process.argv.slice(2),
  executeMigration = runMigration,
  logger = console,
} = {}) => {
  let options;

  try {
    options = parseMigrationArgs(args);
  } catch (error) {
    logger.error(formatCliError(error));
    return 1;
  }

  try {
    const executionOptions =
      options.mode === "repair-processing"
        ? { repairProcessingRecordId: options.repairProcessingRecordId, logger }
        : { apply: options.apply, logger };
    await executeMigration(executionOptions);
    return 0;
  } catch (error) {
    logger.error(formatCliError(error));
    return 1;
  }
};

if (require.main === module) {
  runMigrationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  CLI_USAGE,
  COLLECTION_NAME,
  TTL_INDEX_KEY,
  TTL_INDEX_NAME,
  PROCESSING_RECORD_SAMPLE_LIMIT,
  UNIQUE_INDEX_KEY,
  UNIQUE_INDEX_NAME,
  classifyIndexes,
  countDuplicateScopes,
  formatCliError,
  inspectProcessingRecords,
  migrateDatabase,
  parseMigrationArgs,
  repairProcessingRecord,
  runMigration,
  runMigrationCli,
};
