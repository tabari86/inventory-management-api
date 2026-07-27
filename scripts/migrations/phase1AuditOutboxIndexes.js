const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const CLI_USAGE = "Usage: npm run migrate:phase1-audit-outbox [-- --apply]";
const COLLECTIONS = Object.freeze({
  audit: "auditevents",
  outbox: "outboxevents",
});
const INDEX_DEFINITIONS = Object.freeze([
  {
    collection: COLLECTIONS.audit,
    name: "uq_audit_event_id",
    key: Object.freeze({ auditEventId: 1 }),
    unique: true,
    duplicateKey: Object.freeze({ auditEventId: "$auditEventId" }),
    duplicateMatch: Object.freeze({}),
  },
  {
    collection: COLLECTIONS.audit,
    name: "idx_audit_resource_occurred_at",
    key: Object.freeze({
      "resource.type": 1,
      "resource.id": 1,
      occurredAt: -1,
    }),
    unique: false,
  },
  {
    collection: COLLECTIONS.audit,
    name: "idx_audit_correlation_occurred_at",
    key: Object.freeze({ correlationId: 1, occurredAt: -1 }),
    unique: false,
  },
  {
    collection: COLLECTIONS.audit,
    name: "idx_audit_actor_occurred_at",
    key: Object.freeze({
      "actor.type": 1,
      "actor.id": 1,
      occurredAt: -1,
    }),
    unique: false,
  },
  {
    collection: COLLECTIONS.audit,
    name: "idx_audit_idempotency_occurred_at",
    key: Object.freeze({ "idempotency.recordId": 1, occurredAt: -1 }),
    unique: false,
  },
  {
    collection: COLLECTIONS.outbox,
    name: "uq_outbox_event_id",
    key: Object.freeze({ eventId: 1 }),
    unique: true,
    duplicateKey: Object.freeze({ eventId: "$eventId" }),
    duplicateMatch: Object.freeze({}),
  },
  {
    collection: COLLECTIONS.outbox,
    name: "uq_outbox_aggregate_version",
    key: Object.freeze({
      "aggregate.type": 1,
      "aggregate.id": 1,
      "aggregate.version": 1,
    }),
    unique: true,
    duplicateKey: Object.freeze({
      aggregateType: "$aggregate.type",
      aggregateId: "$aggregate.id",
      aggregateVersion: "$aggregate.version",
    }),
    duplicateMatch: Object.freeze({}),
  },
  {
    collection: COLLECTIONS.outbox,
    name: "idx_outbox_delivery_pending",
    key: Object.freeze({
      "delivery.status": 1,
      "delivery.nextAttemptAt": 1,
      createdAt: 1,
    }),
    unique: false,
  },
  {
    collection: COLLECTIONS.outbox,
    name: "idx_outbox_correlation_created_at",
    key: Object.freeze({ correlationId: 1, createdAt: 1 }),
    unique: false,
  },
]);

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
  const error = new Error("Invalid migration arguments");
  error.code = "INVALID_MIGRATION_ARGS";
  throw error;
};

const formatCliError = (error) =>
  error?.code === "INVALID_MIGRATION_ARGS"
    ? CLI_USAGE
    : "Audit/outbox index migration failed. Review safe migration diagnostics.";

const exactOrderedKey = (actual = {}, expected = {}) => {
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

const sameFields = (actual = {}, expected = {}) => {
  const actualFields = Object.keys(actual).sort();
  const expectedFields = Object.keys(expected).sort();
  return (
    actualFields.length === expectedFields.length &&
    actualFields.every((field, index) => field === expectedFields[index])
  );
};

const simpleCollation = (index) =>
  index.collation === undefined || index.collation?.locale === "simple";

const semanticallyEquivalent = (index, definition) =>
  exactOrderedKey(index.key, definition.key) &&
  (definition.unique ? index.unique === true : index.unique !== true) &&
  index.prepareUnique !== true &&
  index.sparse !== true &&
  index.partialFilterExpression === undefined &&
  simpleCollation(index) &&
  index.hidden !== true &&
  index.expireAfterSeconds === undefined;

const classifyDefinition = ({ indexes, definition }) => {
  const badReserved = indexes.find(
    (index) =>
      index.name === definition.name &&
      !semanticallyEquivalent(index, definition)
  );
  if (badReserved) {
    return { state: "incompatible", existingName: badReserved.name };
  }

  const incompatibleRelated = indexes.find(
    (index) =>
      sameFields(index.key, definition.key) &&
      !semanticallyEquivalent(index, definition)
  );
  if (incompatibleRelated) {
    return {
      state: "incompatible",
      existingName: incompatibleRelated.name,
    };
  }

  const equivalent = indexes.find((index) =>
    semanticallyEquivalent(index, definition)
  );
  return equivalent
    ? { state: "present", existingName: equivalent.name }
    : { state: "absent", existingName: null };
};

const inspectCollection = async (db, collectionName) => {
  const collections = await db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();
  if (collections.length === 0) return { exists: false, indexes: [] };
  try {
    return {
      exists: true,
      indexes: await db.collection(collectionName).listIndexes().toArray(),
    };
  } catch (error) {
    if (error.codeName === "NamespaceNotFound" || error.code === 26) {
      return { exists: false, indexes: [] };
    }
    throw error;
  }
};

const countDuplicateGroups = async ({ db, definition, exists }) => {
  if (!exists || !definition.unique) return 0;
  const rows = await db
    .collection(definition.collection)
    .aggregate([
      { $match: definition.duplicateMatch },
      { $group: { _id: definition.duplicateKey, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "count" },
    ])
    .toArray();
  return rows[0]?.count || 0;
};

const migrateDatabase = async ({ db, apply = false }) => {
  const inspections = new Map();
  for (const collectionName of Object.values(COLLECTIONS)) {
    inspections.set(collectionName, await inspectCollection(db, collectionName));
  }

  const ttlIndexes = [];
  for (const [collectionName, inspection] of inspections) {
    for (const index of inspection.indexes) {
      if (index.expireAfterSeconds !== undefined) {
        ttlIndexes.push({ collection: collectionName, name: index.name });
      }
    }
  }

  const classified = [];
  const duplicateCounts = {};
  for (const definition of INDEX_DEFINITIONS) {
    const inspection = inspections.get(definition.collection);
    classified.push({
      definition,
      classification: classifyDefinition({
        indexes: inspection.indexes,
        definition,
      }),
    });
    if (definition.unique) {
      duplicateCounts[definition.name] = await countDuplicateGroups({
        db,
        definition,
        exists: inspection.exists,
      });
    }
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    database: db.databaseName,
    collections: Object.fromEntries(
      [...inspections].map(([name, inspection]) => [name, { exists: inspection.exists }])
    ),
    duplicateGroupCounts: duplicateCounts,
    ttlIndexes,
    indexes: Object.fromEntries(
      classified.map(({ definition, classification }) => [
        definition.name,
        {
          collection: definition.collection,
          existingName: classification.existingName,
          alreadyPresent: classification.state === "present",
          wouldCreate: classification.state === "absent",
          created: false,
          incompatible: classification.state === "incompatible",
        },
      ])
    ),
  };

  if (
    ttlIndexes.length > 0 ||
    classified.some(({ classification }) => classification.state === "incompatible")
  ) {
    const error = new Error("Incompatible audit/outbox indexes block migration");
    error.migrationSummary = summary;
    throw error;
  }
  if (!apply) return summary;
  if (Object.values(duplicateCounts).some((count) => count > 0)) {
    const error = new Error("Duplicate event identities block index creation");
    error.migrationSummary = summary;
    throw error;
  }

  for (const { definition, classification } of classified) {
    if (classification.state !== "absent") continue;
    const options = { name: definition.name };
    if (definition.unique) options.unique = true;
    await db.collection(definition.collection).createIndex(definition.key, options);
    summary.indexes[definition.name].created = true;
  }
  return summary;
};

const runMigration = async ({
  uri = process.env.MONGODB_URI,
  apply = false,
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
    result = await migrateDatabase({ db: connection.db, apply });
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
    await executeMigration({ apply: options.apply, logger });
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
  COLLECTIONS,
  INDEX_DEFINITIONS,
  classifyDefinition,
  countDuplicateGroups,
  exactOrderedKey,
  formatCliError,
  migrateDatabase,
  parseMigrationArgs,
  runMigration,
  runMigrationCli,
  semanticallyEquivalent,
};
