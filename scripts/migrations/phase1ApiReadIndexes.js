const mongoose = require("mongoose");
const dotenv = require("dotenv");

const { API_READ_INDEXES } = require("../../src/config/apiReadIndexes");
const Product = require("../../src/models/Product");
const Stock = require("../../src/models/Stock");
const StockMovement = require("../../src/models/StockMovement");
const Warehouse = require("../../src/models/Warehouse");

dotenv.config({ quiet: true });

const CLI_USAGE =
  "Usage: npm run migrate:phase1-api-read-indexes [-- --apply]";
const REQUIRED_MODELS = Object.freeze([
  Product,
  Warehouse,
  Stock,
  StockMovement,
]);
const COLLECTIONS = Object.freeze(
  REQUIRED_MODELS.map((model) => model.collection.name)
);
const MAX_BLOCKING_ISSUES = 50;

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

const sameKeyFields = (actual = {}, expected = {}) => {
  const actualFields = Object.keys(actual).sort();
  const expectedFields = Object.keys(expected).sort();
  return (
    actualFields.length === expectedFields.length &&
    actualFields.every((field, index) => field === expectedFields[index])
  );
};

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])])
  );
};

const sameSemanticDocument = (actual, expected) =>
  JSON.stringify(canonicalValue(actual)) ===
  JSON.stringify(canonicalValue(expected));

const compatibleCollation = (actual, expected) => {
  if (expected !== undefined) return sameSemanticDocument(actual, expected);
  return actual === undefined || actual?.locale === "simple";
};

const generatedIndexName = (key) =>
  Object.entries(key)
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");

const schemaIndexDefinition = ({ id, model, fields }) => {
  const expectedKey = Object.fromEntries(fields.map((field) => [field, 1]));
  const schemaIndex = model.schema
    .indexes()
    .find(
      ([key, options]) =>
        exactOrderedKey(key, expectedKey) && options.unique === true
    );
  if (!schemaIndex) {
    throw new Error(`Required schema index definition is missing: ${id}`);
  }

  const [key, options] = schemaIndex;
  return Object.freeze({
    id,
    collection: model.collection.name,
    name: options.name || generatedIndexName(key),
    key: Object.freeze({ ...key }),
    unique: true,
    ...(options.partialFilterExpression
      ? {
          partialFilterExpression: Object.freeze(
            canonicalValue(options.partialFilterExpression)
          ),
        }
      : {}),
    ...(options.sparse === true ? { sparse: true } : {}),
    ...(options.collation
      ? { collation: Object.freeze({ ...options.collation }) }
      : {}),
  });
};

const PREREQUISITE_INDEXES = Object.freeze([
  schemaIndexDefinition({
    id: "productSkuUnique",
    model: Product,
    fields: ["sku"],
  }),
  schemaIndexDefinition({
    id: "warehouseCodeUnique",
    model: Warehouse,
    fields: ["code"],
  }),
  schemaIndexDefinition({
    id: "stockProductWarehouseUnique",
    model: Stock,
    fields: ["productId", "warehouseId"],
  }),
  schemaIndexDefinition({
    id: "stockMovementAggregateVersionUnique",
    model: StockMovement,
    fields: ["stockId", "aggregateVersion"],
  }),
]);

const hasCompatiblePrerequisiteOptions = (index, definition) =>
  index.unique === definition.unique &&
  index.prepareUnique !== true &&
  (definition.sparse === true
    ? index.sparse === true
    : index.sparse !== true) &&
  sameSemanticDocument(
    index.partialFilterExpression,
    definition.partialFilterExpression
  ) &&
  compatibleCollation(index.collation, definition.collation) &&
  index.hidden !== true &&
  index.expireAfterSeconds === undefined;

const prerequisiteSemanticallyEquivalent = (index, definition) =>
  exactOrderedKey(index.key, definition.key) &&
  hasCompatiblePrerequisiteOptions(index, definition);

const classifyPrerequisiteDefinition = ({ indexes, definition }) => {
  const reservedName = indexes.find((index) => index.name === definition.name);
  if (
    reservedName &&
    !prerequisiteSemanticallyEquivalent(reservedName, definition)
  ) {
    return { state: "incompatible", existingName: reservedName.name };
  }

  const equivalent = indexes.find((index) =>
    prerequisiteSemanticallyEquivalent(index, definition)
  );
  if (equivalent) {
    return {
      state: equivalent.name === definition.name ? "present" : "equivalent",
      existingName: equivalent.name,
    };
  }

  const incompatibleRelated = indexes.find((index) =>
    sameKeyFields(index.key, definition.key)
  );
  return incompatibleRelated
    ? { state: "incompatible", existingName: incompatibleRelated.name }
    : { state: "missing", existingName: null };
};

const apiReadIndexSemanticallyEquivalent = (index, definition) =>
  exactOrderedKey(index.key, definition.key) &&
  index.unique !== true &&
  index.prepareUnique !== true &&
  index.sparse !== true &&
  index.hidden !== true &&
  index.partialFilterExpression === undefined &&
  index.expireAfterSeconds === undefined &&
  compatibleCollation(index.collation);

const classifyDefinition = ({ indexes, definition }) => {
  const reservedName = indexes.find((index) => index.name === definition.name);
  if (
    reservedName &&
    !apiReadIndexSemanticallyEquivalent(reservedName, definition)
  ) {
    return { state: "incompatible", existingName: reservedName.name };
  }

  const equivalent = indexes.find((index) =>
    apiReadIndexSemanticallyEquivalent(index, definition)
  );
  if (equivalent) {
    return {
      state: equivalent.name === definition.name ? "present" : "equivalent",
      existingName: equivalent.name,
    };
  }

  const sameKey = indexes.find((index) =>
    sameKeyFields(index.key, definition.key)
  );
  return sameKey
    ? { state: "incompatible", existingName: sameKey.name }
    : { state: "absent", existingName: null };
};

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
    : "API read-index migration failed. Review safe migration diagnostics.";

const formatMigrationFailure = (error) => {
  const message = formatCliError(error);
  if (!error?.migrationSummary) return message;
  return JSON.stringify(
    { error: message, summary: error.migrationSummary },
    null,
    2
  );
};

const collectionExists = async (db, name) => {
  const collections = await db
    .listCollections({ name }, { nameOnly: true })
    .toArray();
  return collections.length === 1;
};

const inspectCollection = async (db, name) => {
  const exists = await collectionExists(db, name);
  if (!exists) {
    return {
      exists: false,
      indexes: [],
      documentCount: 0,
      validCreatedAtCount: 0,
      missingOrInvalidCreatedAtCount: 0,
    };
  }

  let indexes;
  try {
    indexes = await db.collection(name).listIndexes().toArray();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound" || error.code === 26) {
      return {
        exists: false,
        indexes: [],
        documentCount: 0,
        validCreatedAtCount: 0,
        missingOrInvalidCreatedAtCount: 0,
      };
    }
    throw error;
  }

  const [documentCount, validCreatedAtCount] = await Promise.all([
    db.collection(name).countDocuments({}),
    db.collection(name).countDocuments({ createdAt: { $type: "date" } }),
  ]);
  return {
    exists: true,
    indexes,
    documentCount,
    validCreatedAtCount,
    missingOrInvalidCreatedAtCount: documentCount - validCreatedAtCount,
  };
};

const migrateDatabase = async ({ db, apply = false }) => {
  const inspections = new Map();
  for (const collection of COLLECTIONS) {
    inspections.set(collection, await inspectCollection(db, collection));
  }

  const prerequisites = PREREQUISITE_INDEXES.map((definition) => ({
    definition,
    classification: classifyPrerequisiteDefinition({
      indexes: inspections.get(definition.collection).indexes,
      definition,
    }),
  }));
  const apiReadIndexes = API_READ_INDEXES.map((definition) => ({
    definition,
    classification: classifyDefinition({
      indexes: inspections.get(definition.collection).indexes,
      definition,
    }),
  }));

  const blockingIssues = [];
  for (const [collection, inspection] of inspections) {
    if (!inspection.exists) {
      blockingIssues.push({ type: "missing_collection", collection });
    }
    if (inspection.missingOrInvalidCreatedAtCount > 0) {
      blockingIssues.push({
        type: "invalid_created_at",
        collection,
        count: inspection.missingOrInvalidCreatedAtCount,
      });
    }
  }
  for (const { definition, classification } of prerequisites) {
    if (["missing", "incompatible"].includes(classification.state)) {
      blockingIssues.push({
        type: `prerequisite_index_${classification.state}`,
        collection: definition.collection,
        index: definition.id,
      });
    }
  }
  for (const { definition, classification } of apiReadIndexes) {
    if (classification.state === "incompatible") {
      blockingIssues.push({
        type: "api_read_index_incompatible",
        collection: definition.collection,
        index: definition.name,
      });
    }
  }
  const canApply = blockingIssues.length === 0;
  const prerequisiteIndexStatus = Object.fromEntries(
    prerequisites.map(({ definition, classification }) => [
      definition.id,
      {
        collection: definition.collection,
        key: definition.key,
        unique: definition.unique,
        ...(definition.partialFilterExpression
          ? { partialFilterExpression: definition.partialFilterExpression }
          : {}),
        expectedName: definition.name,
        existingName: classification.existingName,
        state: classification.state,
      },
    ])
  );
  const apiReadIndexStatus = Object.fromEntries(
    apiReadIndexes.map(({ definition, classification }) => [
      definition.name,
      {
        collection: definition.collection,
        key: definition.key,
        existingName: classification.existingName,
        state: classification.state,
        alreadyPresent: ["present", "equivalent"].includes(
          classification.state
        ),
        wouldCreate: canApply && classification.state === "absent",
        created: false,
        incompatible: classification.state === "incompatible",
      },
    ])
  );
  const summary = {
    mode: apply ? "apply" : "dry-run",
    database: db.databaseName,
    collections: Object.fromEntries(
      [...inspections].map(([name, inspection]) => [
        name,
        {
          exists: inspection.exists,
          documentCount: inspection.documentCount,
          validCreatedAtCount: inspection.validCreatedAtCount,
          missingOrInvalidCreatedAtCount:
            inspection.missingOrInvalidCreatedAtCount,
        },
      ])
    ),
    prerequisiteIndexStatus,
    apiReadIndexStatus,
    blockingIssues: blockingIssues.slice(0, MAX_BLOCKING_ISSUES),
    canApply,
    appliedIndexes: [],
  };
  // Retain the initial WP7 summary key for operators consuming dry-run output.
  summary.indexes = summary.apiReadIndexStatus;

  if (!canApply) {
    const error = new Error("API read-index migration preflight is blocked");
    error.code = "MIGRATION_PREFLIGHT_BLOCKED";
    error.migrationSummary = summary;
    throw error;
  }
  if (!apply) return summary;

  for (const { definition, classification } of apiReadIndexes) {
    if (classification.state !== "absent") continue;
    await db.collection(definition.collection).createIndex(definition.key, {
      name: definition.name,
    });
    summary.apiReadIndexStatus[definition.name].state = "created";
    summary.apiReadIndexStatus[definition.name].created = true;
    summary.apiReadIndexStatus[definition.name].wouldCreate = false;
    summary.appliedIndexes.push({
      collection: definition.collection,
      name: definition.name,
    });
  }
  return summary;
};

const runMigration = async ({
  uri = process.env.MONGODB_URI,
  apply = false,
  logger = console,
  createConnection = (connectionUri) =>
    mongoose.createConnection(connectionUri, { autoIndex: false }).asPromise(),
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
    logger.error(formatMigrationFailure(error));
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
  INDEX_DEFINITIONS: API_READ_INDEXES,
  MAX_BLOCKING_ISSUES,
  PREREQUISITE_INDEXES,
  apiReadIndexSemanticallyEquivalent,
  classifyDefinition,
  classifyPrerequisiteDefinition,
  exactOrderedKey,
  formatCliError,
  formatMigrationFailure,
  inspectCollection,
  migrateDatabase,
  parseMigrationArgs,
  prerequisiteSemanticallyEquivalent,
  runMigration,
  runMigrationCli,
  semanticallyEquivalent: apiReadIndexSemanticallyEquivalent,
};
