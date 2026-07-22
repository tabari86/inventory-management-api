const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const MOVEMENT_VERSION_INDEX = "stock_aggregate_version_unique";
const MOVEMENT_VERSION_INDEX_KEY = Object.freeze({
  stockId: 1,
  aggregateVersion: 1,
});
const MOVEMENT_VERSION_INDEX_PARTIAL_FILTER = Object.freeze({
  aggregateVersion: Object.freeze({ $type: "number" }),
});
const CLI_USAGE =
  "Usage: npm run migrate:phase1-lifecycle [-- --apply]";

const invalidVersionFilter = {
  $expr: {
    $let: {
      vars: {
        normalizedVersion: {
          $convert: {
            input: "$version",
            to: "long",
            onError: null,
            onNull: null,
          },
        },
      },
      in: {
        $or: [
          { $eq: ["$$normalizedVersion", null] },
          { $lt: ["$$normalizedVersion", 1] },
          { $ne: ["$$normalizedVersion", "$version"] },
        ],
      },
    },
  },
};

const isValidVersion = (value) => Number.isInteger(value) && value >= 1;

const getDuplicateMovementVersions = (db) =>
  db
    .collection("stockmovements")
    .aggregate([
      { $match: { aggregateVersion: { $type: "number" } } },
      {
        $group: {
          _id: { stockId: "$stockId", aggregateVersion: "$aggregateVersion" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { "_id.stockId": 1, "_id.aggregateVersion": 1 } },
    ])
    .toArray();

const inspectIndexes = async (db) => {
  try {
    return await db.collection("stockmovements").listIndexes().toArray();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound" || error.code === 26) return [];
    throw error;
  }
};

const hasExactOrderedKeyPattern = (key = {}) => {
  const entries = Object.entries(key);
  const requiredEntries = Object.entries(MOVEMENT_VERSION_INDEX_KEY);

  return (
    entries.length === requiredEntries.length &&
    entries.every(
      ([field, direction], index) =>
        field === requiredEntries[index][0] &&
        direction === requiredEntries[index][1]
    )
  );
};

const hasCompatiblePartialFilter = (partialFilterExpression) => {
  if (
    !partialFilterExpression ||
    typeof partialFilterExpression !== "object" ||
    Array.isArray(partialFilterExpression)
  ) {
    return false;
  }

  const filterEntries = Object.entries(partialFilterExpression);
  if (filterEntries.length !== 1 || filterEntries[0][0] !== "aggregateVersion") {
    return false;
  }

  const aggregateVersionFilter = filterEntries[0][1];
  return (
    aggregateVersionFilter &&
    typeof aggregateVersionFilter === "object" &&
    !Array.isArray(aggregateVersionFilter) &&
    Object.keys(aggregateVersionFilter).length === 1 &&
    aggregateVersionFilter.$type === "number"
  );
};

const isEquivalentMovementVersionIndex = (index) =>
  hasExactOrderedKeyPattern(index.key) &&
  index.unique === true &&
  hasCompatiblePartialFilter(index.partialFilterExpression);

const classifyMovementVersionIndexes = (indexes) => {
  const incompatibleIndex = indexes.find(
    (index) =>
      (index.name === MOVEMENT_VERSION_INDEX ||
        hasExactOrderedKeyPattern(index.key)) &&
      !isEquivalentMovementVersionIndex(index)
  );

  if (incompatibleIndex) {
    return {
      state: "incompatible",
      existingName: incompatibleIndex.name,
    };
  }

  const equivalentIndex = indexes.find(isEquivalentMovementVersionIndex);
  if (equivalentIndex) {
    return {
      state: "present",
      existingName: equivalentIndex.name,
    };
  }

  return { state: "absent", existingName: null };
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
    : "Lifecycle/version migration failed. Review safe migration diagnostics.";

const migrateDatabase = async ({ db, apply = false }) => {
  const productsCollection = db.collection("products");
  const warehousesCollection = db.collection("warehouses");
  const stocksCollection = db.collection("stocks");
  const movementsCollection = db.collection("stockmovements");

  const products = await productsCollection.find({}).toArray();
  const warehouses = await warehousesCollection.find({}).toArray();
  const stocks = await stocksCollection.find({}).toArray();
  const movements = await movementsCollection.find({}).toArray();
  const duplicateMovementVersions = await getDuplicateMovementVersions(db);
  const existingIndexes = await inspectIndexes(db);
  const indexInspection = classifyMovementVersionIndexes(existingIndexes);

  const productById = new Map(
    products.map((product) => [product._id.toString(), product])
  );
  const warehouseById = new Map(
    warehouses.map((warehouse) => [warehouse._id.toString(), warehouse])
  );
  const stockById = new Map(
    stocks.map((stock) => [stock._id.toString(), stock])
  );

  const orphanStocks = [];
  const stockUpdates = [];

  for (const stock of stocks) {
    const product = productById.get(stock.productId?.toString());
    const warehouse = warehouseById.get(stock.warehouseId?.toString());
    const missing = [];
    if (!product) missing.push("product");
    if (!warehouse) missing.push("warehouse");

    if (missing.length > 0) {
      orphanStocks.push({ stockId: stock._id.toString(), missing });
    }

    const fieldsToSet = {};

    if (!isValidVersion(stock.version)) fieldsToSet.version = 1;

    if (product) {
      const productLifecycleStatus = product.archivedAt
        ? "archived"
        : product.status === "active"
          ? "active"
          : "inactive";

      if (stock.productLifecycleStatus !== productLifecycleStatus) {
        fieldsToSet.productLifecycleStatus = productLifecycleStatus;
      }
    }

    if (warehouse) {
      const warehouseLifecycleStatus =
        warehouse.status === "active" ? "active" : "inactive";

      if (stock.warehouseLifecycleStatus !== warehouseLifecycleStatus) {
        fieldsToSet.warehouseLifecycleStatus = warehouseLifecycleStatus;
      }
    }

    if (Object.keys(fieldsToSet).length > 0) {
      stockUpdates.push({
        updateOne: {
          filter: { _id: stock._id },
          update: { $set: fieldsToSet },
        },
      });
    }
  }

  const legacyMovementCount = movements.filter(
    (movement) =>
      movement.productId === undefined ||
      movement.warehouseId === undefined ||
      movement.quantityBefore === undefined ||
      movement.quantityAfter === undefined ||
      movement.aggregateVersion === undefined ||
      movement.productSnapshot === undefined ||
      movement.warehouseSnapshot === undefined
  ).length;
  const movementUpdates = [];

  for (const movement of movements) {
    const stock = stockById.get(movement.stockId?.toString());
    if (!stock) continue;

    const fieldsToSet = {};
    if (movement.productId === undefined && stock.productId) {
      fieldsToSet.productId = stock.productId;
    }
    if (movement.warehouseId === undefined && stock.warehouseId) {
      fieldsToSet.warehouseId = stock.warehouseId;
    }

    if (Object.keys(fieldsToSet).length > 0) {
      movementUpdates.push({
        updateOne: {
          filter: { _id: movement._id },
          update: { $set: fieldsToSet },
        },
      });
    }
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    database: db.databaseName,
    products: {
      total: products.length,
      invalidVersions: products.filter(
        (product) => !isValidVersion(product.version)
      ).length,
    },
    warehouses: {
      total: warehouses.length,
      invalidVersions: warehouses.filter(
        (warehouse) => !isValidVersion(warehouse.version)
      ).length,
    },
    stocks: {
      total: stocks.length,
      updatesRequired: stockUpdates.length,
      orphanCount: orphanStocks.length,
      orphans: orphanStocks,
    },
    stockMovements: {
      total: movements.length,
      legacyIntegrityRows: legacyMovementCount,
      directReferenceBackfills: movementUpdates.length,
      duplicateVersionCandidates: duplicateMovementVersions.map(
        ({ _id, count }) => ({
          stockId: _id.stockId.toString(),
          aggregateVersion: _id.aggregateVersion,
          count,
        })
      ),
    },
    index: {
      name: MOVEMENT_VERSION_INDEX,
      existingName: indexInspection.existingName,
      alreadyPresent: indexInspection.state === "present",
      wouldCreate: indexInspection.state === "absent",
      created: false,
      blockedByDuplicates: duplicateMovementVersions.length > 0,
      incompatible: indexInspection.state === "incompatible",
    },
  };

  if (indexInspection.state === "incompatible") {
    const error = new Error(
      "Incompatible StockMovement aggregate-version index blocks migration"
    );
    error.migrationSummary = summary;
    throw error;
  }

  if (!apply) return summary;

  if (duplicateMovementVersions.length > 0) {
    const error = new Error(
      "Duplicate Stock/aggregateVersion candidates block safe index creation"
    );
    error.migrationSummary = summary;
    throw error;
  }

  await productsCollection.updateMany(invalidVersionFilter, {
    $set: { version: 1 },
  });
  await warehousesCollection.updateMany(invalidVersionFilter, {
    $set: { version: 1 },
  });
  if (stockUpdates.length > 0) {
    await stocksCollection.bulkWrite(stockUpdates, { ordered: true });
  }
  if (movementUpdates.length > 0) {
    await movementsCollection.bulkWrite(movementUpdates, { ordered: true });
  }

  if (indexInspection.state === "absent") {
    await movementsCollection.createIndex(
      MOVEMENT_VERSION_INDEX_KEY,
      {
        name: MOVEMENT_VERSION_INDEX,
        unique: true,
        partialFilterExpression: MOVEMENT_VERSION_INDEX_PARTIAL_FILTER,
      }
    );
    summary.index.created = true;
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
  let migrationResult;
  let migrationError;
  let migrationFailed = false;
  let cleanupError;

  try {
    connection = await createConnection(uri);
    migrationResult = await migrateDatabase({ db: connection.db, apply });
  } catch (error) {
    migrationFailed = true;
    migrationError = error;
  }

  if (connection) {
    try {
      await connection.close();
    } catch (error) {
      cleanupError = error;
    }
  }

  if (migrationFailed) {
    throw migrationError;
  }

  if (cleanupError) {
    throw cleanupError;
  }

  logger.log(JSON.stringify(migrationResult, null, 2));
  return migrationResult;
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
  MOVEMENT_VERSION_INDEX,
  MOVEMENT_VERSION_INDEX_KEY,
  MOVEMENT_VERSION_INDEX_PARTIAL_FILTER,
  classifyMovementVersionIndexes,
  formatCliError,
  migrateDatabase,
  parseMigrationArgs,
  runMigration,
  runMigrationCli,
};
