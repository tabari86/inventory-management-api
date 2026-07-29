const mongoose = require("mongoose");

const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const {
  COLLECTIONS,
  INDEX_DEFINITIONS,
  MAX_BLOCKING_ISSUES,
  PREREQUISITE_INDEXES,
  migrateDatabase,
  parseMigrationArgs,
  runMigration,
  runMigrationCli,
} = require("../scripts/migrations/phase1ApiReadIndexes");

require("./setupTestDb");

const schemaByCollection = {
  products: Product.schema,
  warehouses: Warehouse.schema,
  stocks: Stock.schema,
  stockmovements: StockMovement.schema,
};

const seedCollections = async (
  db,
  {
    collections = COLLECTIONS,
    omitPrerequisites = [],
    prerequisiteNames = {},
  } = {}
) => {
  for (const collection of collections) {
    await db.collection(collection).insertOne({
      marker: collection,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  }
  for (const definition of PREREQUISITE_INDEXES) {
    if (
      !collections.includes(definition.collection) ||
      omitPrerequisites.includes(definition.id)
    ) {
      continue;
    }
    await db.collection(definition.collection).createIndex(definition.key, {
      name: prerequisiteNames[definition.id] || definition.name,
      unique: true,
      ...(definition.partialFilterExpression
        ? { partialFilterExpression: definition.partialFilterExpression }
        : {}),
      ...(definition.sparse ? { sparse: true } : {}),
      ...(definition.collation ? { collation: definition.collation } : {}),
    });
  }
};

const readIndexes = async (db) =>
  Object.fromEntries(
    await Promise.all(
      COLLECTIONS.map(async (collection) => [
        collection,
        (await db.collection(collection).listIndexes().toArray()).map(
          ({ name, key, unique, partialFilterExpression }) => ({
            name,
            key,
            unique,
            partialFilterExpression,
          })
        ),
      ])
    )
  );

describe("WP7 API read-index definitions and migration", () => {
  let db;

  beforeEach(() => {
    db = mongoose.connection.client.db("wp7_api_read_index_migration");
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await db.dropDatabase();
  });

  it("defines every exact named index in the matching Mongoose schema", () => {
    for (const definition of INDEX_DEFINITIONS) {
      const schemaIndex = schemaByCollection[definition.collection]
        .indexes()
        .find(([, options]) => options.name === definition.name);
      expect(schemaIndex).toBeDefined();
      expect(Object.entries(schemaIndex[0])).toEqual(Object.entries(definition.key));
      expect(schemaIndex[1]).toMatchObject({ name: definition.name });
      expect(schemaIndex[1]).not.toHaveProperty("expireAfterSeconds");
    }

    expect(
      StockMovement.schema.indexes().find(
        ([, options]) => options.name === "stock_aggregate_version_unique"
      )
    ).toBeDefined();
  });

  it("reports a dry run without creating indexes or modifying documents", async () => {
    await seedCollections(db);
    const documentsBefore = {};
    const indexesBefore = {};
    for (const collection of COLLECTIONS) {
      documentsBefore[collection] = await db.collection(collection).find({}).toArray();
      indexesBefore[collection] = await db
        .collection(collection)
        .listIndexes()
        .toArray();
    }

    const summary = await migrateDatabase({ db, apply: false });
    expect(summary.mode).toBe("dry-run");
    expect(summary.canApply).toBe(true);
    expect(summary.blockingIssues).toEqual([]);
    expect(
      Object.values(summary.prerequisiteIndexStatus).every(
        ({ state }) => state === "present"
      )
    ).toBe(true);
    expect(Object.values(summary.indexes).every(({ wouldCreate }) => wouldCreate)).toBe(
      true
    );
    for (const collection of COLLECTIONS) {
      expect(await db.collection(collection).find({}).toArray()).toEqual(
        documentsBefore[collection]
      );
      expect(await db.collection(collection).listIndexes().toArray()).toEqual(
        indexesBefore[collection]
      );
      expect(summary.collections[collection].missingOrInvalidCreatedAtCount).toBe(0);
    }
  });

  it("creates only missing indexes and is idempotent on a second apply", async () => {
    await seedCollections(db);
    const first = await migrateDatabase({ db, apply: true });
    expect(Object.values(first.indexes).every(({ created }) => created)).toBe(true);

    const second = await migrateDatabase({ db, apply: true });
    expect(Object.values(second.indexes).every(({ alreadyPresent }) => alreadyPresent)).toBe(
      true
    );
    expect(Object.values(second.indexes).every(({ created }) => !created)).toBe(true);

    for (const collection of COLLECTIONS) {
      const indexes = await db.collection(collection).listIndexes().toArray();
      expect(indexes.some((index) => index.expireAfterSeconds !== undefined)).toBe(false);
    }
  });

  it("recognizes an equivalent differently named index", async () => {
    await seedCollections(db);
    const definition = INDEX_DEFINITIONS[0];
    await db
      .collection(definition.collection)
      .createIndex(definition.key, { name: "equivalent_external_name" });

    const summary = await migrateDatabase({ db, apply: false });
    expect(summary.indexes[definition.name]).toMatchObject({
      alreadyPresent: true,
      existingName: "equivalent_external_name",
      wouldCreate: false,
      incompatible: false,
    });
  });

  it("accepts every prerequisite under a semantically equivalent name", async () => {
    const prerequisiteNames = Object.fromEntries(
      PREREQUISITE_INDEXES.map((definition) => [
        definition.id,
        `equivalent_${definition.id}`,
      ])
    );
    await seedCollections(db, { prerequisiteNames });

    const summary = await migrateDatabase({ db, apply: false });

    for (const definition of PREREQUISITE_INDEXES) {
      expect(summary.prerequisiteIndexStatus[definition.id]).toMatchObject({
        state: "equivalent",
        existingName: prerequisiteNames[definition.id],
        key: definition.key,
        unique: true,
      });
    }
    expect(summary.canApply).toBe(true);
  });

  it.each(PREREQUISITE_INDEXES.map(({ id }) => id))(
    "blocks before API index creation when prerequisite %s is missing",
    async (prerequisiteId) => {
      await seedCollections(db, { omitPrerequisites: [prerequisiteId] });
      const indexesBefore = await readIndexes(db);

      await expect(migrateDatabase({ db, apply: true })).rejects.toMatchObject({
        migrationSummary: expect.objectContaining({
          canApply: false,
          appliedIndexes: [],
          prerequisiteIndexStatus: expect.objectContaining({
            [prerequisiteId]: expect.objectContaining({ state: "missing" }),
          }),
        }),
      });

      expect(await readIndexes(db)).toEqual(indexesBefore);
    }
  );

  it("rejects a prerequisite with the same key but unique false", async () => {
    const definition = PREREQUISITE_INDEXES[0];
    await seedCollections(db, { omitPrerequisites: [definition.id] });
    await db.collection(definition.collection).createIndex(definition.key, {
      name: definition.name,
      unique: false,
    });

    await expect(migrateDatabase({ db, apply: false })).rejects.toMatchObject({
      migrationSummary: expect.objectContaining({
        prerequisiteIndexStatus: expect.objectContaining({
          [definition.id]: expect.objectContaining({ state: "incompatible" }),
        }),
      }),
    });
  });

  it("rejects a prerequisite compound key in the wrong order", async () => {
    const definition = PREREQUISITE_INDEXES.find(
      ({ id }) => id === "stockProductWarehouseUnique"
    );
    await seedCollections(db, { omitPrerequisites: [definition.id] });
    await db.collection(definition.collection).createIndex(
      { warehouseId: 1, productId: 1 },
      { name: "wrong_stock_key_order", unique: true }
    );

    await expect(migrateDatabase({ db, apply: false })).rejects.toMatchObject({
      migrationSummary: expect.objectContaining({
        prerequisiteIndexStatus: expect.objectContaining({
          [definition.id]: expect.objectContaining({ state: "incompatible" }),
        }),
      }),
    });
  });

  it("rejects the wrong StockMovement partial filter", async () => {
    const definition = PREREQUISITE_INDEXES.find(
      ({ id }) => id === "stockMovementAggregateVersionUnique"
    );
    await seedCollections(db, { omitPrerequisites: [definition.id] });
    await db.collection(definition.collection).createIndex(definition.key, {
      name: definition.name,
      unique: true,
      partialFilterExpression: { aggregateVersion: { $type: "string" } },
    });

    await expect(migrateDatabase({ db, apply: false })).rejects.toMatchObject({
      migrationSummary: expect.objectContaining({
        prerequisiteIndexStatus: expect.objectContaining({
          [definition.id]: expect.objectContaining({ state: "incompatible" }),
        }),
      }),
    });
  });

  it("rejects an incompatible definition under a reserved prerequisite name", async () => {
    const definition = PREREQUISITE_INDEXES[1];
    await seedCollections(db, { omitPrerequisites: [definition.id] });
    await db.collection(definition.collection).createIndex(
      { wrongWarehouseField: 1 },
      { name: definition.name, unique: true }
    );

    await expect(migrateDatabase({ db, apply: true })).rejects.toMatchObject({
      migrationSummary: expect.objectContaining({
        canApply: false,
        appliedIndexes: [],
        prerequisiteIndexStatus: expect.objectContaining({
          [definition.id]: expect.objectContaining({ state: "incompatible" }),
        }),
      }),
    });
  });

  it("never drops indexes or mutates documents during blocked preflight", async () => {
    const definition = PREREQUISITE_INDEXES[0];
    await seedCollections(db, { omitPrerequisites: [definition.id] });
    const documentsBefore = Object.fromEntries(
      await Promise.all(
        COLLECTIONS.map(async (collection) => [
          collection,
          await db.collection(collection).find({}).toArray(),
        ])
      )
    );
    const dropSpies = COLLECTIONS.map((collection) =>
      jest.spyOn(db.collection(collection), "dropIndex")
    );

    await expect(migrateDatabase({ db, apply: true })).rejects.toBeDefined();

    expect(dropSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    for (const collection of COLLECTIONS) {
      expect(await db.collection(collection).find({}).toArray()).toEqual(
        documentsBefore[collection]
      );
    }
  });

  it("fails safely for an incompatible reserved name or exact key", async () => {
    await seedCollections(db);
    const definition = INDEX_DEFINITIONS[0];
    await db
      .collection(definition.collection)
      .createIndex({ wrong: 1 }, { name: definition.name });

    await expect(migrateDatabase({ db, apply: true })).rejects.toMatchObject({
      migrationSummary: expect.objectContaining({
        indexes: expect.objectContaining({
          [definition.name]: expect.objectContaining({ incompatible: true }),
        }),
      }),
    });
    expect(
      (await db.collection(definition.collection).listIndexes().toArray()).some(
        (index) => index.name === definition.name
      )
    ).toBe(true);
  });

  it("reports and blocks missing or invalid createdAt values without backfilling", async () => {
    await seedCollections(db);
    const invalidId = new mongoose.Types.ObjectId();
    await db.collection("products").insertOne({
      _id: invalidId,
      sku: "INVALID-CREATED-AT",
      createdAt: "invalid",
    });

    await expect(migrateDatabase({ db, apply: true })).rejects.toMatchObject({
      migrationSummary: expect.objectContaining({
        collections: expect.objectContaining({
          products: expect.objectContaining({ missingOrInvalidCreatedAtCount: 1 }),
        }),
      }),
    });
    expect(await db.collection("products").findOne({ _id: invalidId })).toMatchObject({
      createdAt: "invalid",
    });
  });

  it.each([false, true])(
    "blocks %s mode when required collections are missing without creating them",
    async (apply) => {
      await expect(migrateDatabase({ db, apply })).rejects.toMatchObject({
        code: "MIGRATION_PREFLIGHT_BLOCKED",
        migrationSummary: expect.objectContaining({
          mode: apply ? "apply" : "dry-run",
          canApply: false,
          appliedIndexes: [],
          blockingIssues: expect.arrayContaining([
            expect.objectContaining({
              type: "missing_collection",
              collection: "products",
            }),
          ]),
        }),
      });
      expect(
        await db.listCollections({}, { nameOnly: true }).toArray()
      ).toEqual([]);
    }
  );

  it.each([false, true])(
    "reports one missing required collection and creates no API indexes in apply=%s",
    async (apply) => {
      const missingCollection = Warehouse.collection.name;
      const existingCollections = COLLECTIONS.filter(
        (collection) => collection !== missingCollection
      );
      await seedCollections(db, { collections: existingCollections });
      const indexesBefore = Object.fromEntries(
        await Promise.all(
          existingCollections.map(async (collection) => [
            collection,
            await db.collection(collection).listIndexes().toArray(),
          ])
        )
      );

      let failure;
      try {
        await migrateDatabase({ db, apply });
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        migrationSummary: expect.objectContaining({
          canApply: false,
          appliedIndexes: [],
          blockingIssues: expect.arrayContaining([
            { type: "missing_collection", collection: missingCollection },
          ]),
        }),
      });
      expect(
        await db
          .listCollections({ name: missingCollection }, { nameOnly: true })
          .toArray()
      ).toEqual([]);
      for (const collection of existingCollections) {
        expect(await db.collection(collection).listIndexes().toArray()).toEqual(
          indexesBefore[collection]
        );
      }
    }
  );

  it("reports every missing collection in a bounded blocking result", async () => {
    await expect(migrateDatabase({ db, apply: false })).rejects.toMatchObject({
      migrationSummary: expect.objectContaining({ canApply: false }),
    });
    try {
      await migrateDatabase({ db, apply: false });
    } catch (error) {
      const missing = error.migrationSummary.blockingIssues
        .filter(({ type }) => type === "missing_collection")
        .map(({ collection }) => collection);
      expect(missing).toEqual(COLLECTIONS);
      expect(error.migrationSummary.blockingIssues.length).toBeLessThanOrEqual(
        MAX_BLOCKING_ISSUES
      );
    }
    expect(
      await db.listCollections({}, { nameOnly: true }).toArray()
    ).toEqual([]);
  });

  it("accepts only dry-run or the explicit apply argument", () => {
    expect(parseMigrationArgs([])).toEqual({ mode: "dry-run", apply: false });
    expect(parseMigrationArgs(["--apply"])).toEqual({ mode: "apply", apply: true });
    expect(() => parseMigrationArgs(["--force"])).toThrow("Invalid migration arguments");
    expect(() => parseMigrationArgs(["--apply", "extra"])).toThrow(
      "Invalid migration arguments"
    );
  });

  it.each([false, true])(
    "closes the injected connection when missing collections block apply=%s",
    async (apply) => {
      const close = jest.fn().mockResolvedValue();
      const logger = { log: jest.fn(), error: jest.fn() };
      const createConnection = jest.fn().mockResolvedValue({ db, close });

      await expect(
        runMigration({
          uri: "mongodb://safe.invalid/migration-test",
          logger,
          createConnection,
          apply,
        })
      ).rejects.toMatchObject({ code: "MIGRATION_PREFLIGHT_BLOCKED" });
      expect(close).toHaveBeenCalledTimes(1);
      expect(logger.log).not.toHaveBeenCalled();
    }
  );

  it("closes the injected connection and never logs the URI or credentials", async () => {
    const privateUri = "mongodb://private-user:private-password@private-host/database";
    const close = jest.fn().mockResolvedValue();
    const logger = { log: jest.fn(), error: jest.fn() };
    const connection = { db: {}, close };
    const createConnection = jest.fn().mockResolvedValue(connection);

    await expect(
      runMigration({
        uri: privateUri,
        logger,
        createConnection,
        apply: false,
      })
    ).rejects.toBeDefined();
    expect(close).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger)).not.toContain(privateUri);
    expect(JSON.stringify(logger)).not.toContain("private-password");
  });

  it("returns stable CLI status without leaking execution errors", async () => {
    const logger = { log: jest.fn(), error: jest.fn() };
    expect(await runMigrationCli({ args: ["--bad"], logger })).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Usage: npm run migrate:phase1-api-read-indexes [-- --apply]"
    );

    const privateMarker = "mongodb://secret/private";
    const exitCode = await runMigrationCli({
      args: [],
      logger,
      executeMigration: jest.fn().mockRejectedValue(new Error(privateMarker)),
    });
    expect(exitCode).toBe(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(privateMarker);
  });

  it.each([{ args: [] }, { args: ["--apply"] }])(
    "returns a non-zero CLI status for missing collections with args $args",
    async ({ args }) => {
      const logger = { log: jest.fn(), error: jest.fn() };
      const close = jest.fn().mockResolvedValue();
      const exitCode = await runMigrationCli({
        args,
        logger,
        executeMigration: ({ apply }) =>
          runMigration({
            uri: "mongodb://safe.invalid/migration-test",
            apply,
            logger,
            createConnection: jest.fn().mockResolvedValue({ db, close }),
          }),
      });

      expect(exitCode).toBe(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(logger.log).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('"canApply": false')
      );
    }
  );
});
