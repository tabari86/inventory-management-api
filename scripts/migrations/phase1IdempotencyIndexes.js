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
const CLI_USAGE = "Usage: npm run migrate:phase1-idempotency [-- --apply]";

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

const migrateDatabase = async ({ db, apply = false }) => {
  const exists = await collectionExists(db);
  const indexes = await inspectIndexes(db, exists);
  const inspection = classifyIndexes(indexes);
  const duplicateScopeCount = await countDuplicateScopes(db, exists);
  const summary = {
    mode: apply ? "apply" : "dry-run",
    database: db.databaseName,
    collectionExists: exists,
    duplicateScopeCount,
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
  COLLECTION_NAME,
  TTL_INDEX_KEY,
  TTL_INDEX_NAME,
  UNIQUE_INDEX_KEY,
  UNIQUE_INDEX_NAME,
  classifyIndexes,
  countDuplicateScopes,
  formatCliError,
  migrateDatabase,
  parseMigrationArgs,
  runMigration,
  runMigrationCli,
};
