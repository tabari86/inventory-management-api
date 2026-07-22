const mongoose = require("mongoose");

const {
  CLI_USAGE,
  MOVEMENT_VERSION_INDEX,
  MOVEMENT_VERSION_INDEX_KEY,
  MOVEMENT_VERSION_INDEX_PARTIAL_FILTER,
  migrateDatabase,
  parseMigrationArgs,
  runMigration,
  runMigrationCli,
} = require("../scripts/migrations/phase1LifecycleVersion");

require("./setupTestDb");

const insertLegacyGraph = async () => {
  const db = mongoose.connection.db;
  const productId = new mongoose.Types.ObjectId();
  const archivedProductId = new mongoose.Types.ObjectId();
  const warehouseId = new mongoose.Types.ObjectId();
  const stockId = new mongoose.Types.ObjectId();
  const orphanStockId = new mongoose.Types.ObjectId();
  const movementId = new mongoose.Types.ObjectId();

  await db.collection("products").insertMany([
    { _id: productId, sku: "LEGACY-ACTIVE", name: "Legacy Active", status: "active" },
    {
      _id: archivedProductId,
      sku: "LEGACY-ARCHIVED",
      name: "Legacy Archived",
      status: "inactive",
      archivedAt: new Date(),
      version: 0,
    },
  ]);
  await db.collection("warehouses").insertOne({
    _id: warehouseId,
    code: "LEGACY-WH",
    name: "Legacy Warehouse",
    status: "inactive",
    version: 1.5,
  });
  await db.collection("stocks").insertMany([
    {
      _id: stockId,
      productId: archivedProductId,
      warehouseId,
      quantity: 7,
      status: "active",
    },
    {
      _id: orphanStockId,
      productId: new mongoose.Types.ObjectId(),
      warehouseId,
      quantity: 2,
      status: "active",
    },
  ]);
  await db.collection("stockmovements").insertOne({
    _id: movementId,
    stockId,
    type: "GOODS_RECEIPT",
    quantity: 7,
  });

  return {
    db,
    productId,
    archivedProductId,
    warehouseId,
    stockId,
    orphanStockId,
    movementId,
  };
};

const listMovementIndexes = async (db = mongoose.connection.db) => {
  try {
    return await db.collection("stockmovements").listIndexes().toArray();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound" || error.code === 26) return [];
    throw error;
  }
};

const dropMigrationIndex = async () => {
  const collection = mongoose.connection.db.collection("stockmovements");
  const indexes = await listMovementIndexes();

  for (const index of indexes) {
    if (index.name !== "_id_") await collection.dropIndex(index.name);
  }
};

const clearMigrationCollections = async () => {
  for (const name of ["products", "warehouses", "stocks", "stockmovements"]) {
    await mongoose.connection.db.collection(name).deleteMany({});
  }
};

const captureMigrationState = async (db = mongoose.connection.db) => {
  const documents = {};

  for (const name of ["products", "warehouses", "stocks", "stockmovements"]) {
    documents[name] = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
  }

  return {
    documents,
    movementIndexes: await listMovementIndexes(db),
  };
};

const createCompatibleMovementIndex = (db, name = MOVEMENT_VERSION_INDEX) =>
  db.collection("stockmovements").createIndex(MOVEMENT_VERSION_INDEX_KEY, {
    name,
    unique: true,
    partialFilterExpression: MOVEMENT_VERSION_INDEX_PARTIAL_FILTER,
  });

const captureError = async (operation) => {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  throw new Error("Expected operation to reject");
};

const insertDuplicateMovementVersions = async () => {
  const context = await insertLegacyGraph();
  await context.db.collection("stockmovements").insertMany([
    {
      stockId: context.stockId,
      type: "GOODS_RECEIPT",
      quantity: 1,
      aggregateVersion: 2,
    },
    {
      stockId: context.stockId,
      type: "GOODS_RECEIPT",
      quantity: 1,
      aggregateVersion: 2,
    },
  ]);

  return context;
};

describe("Phase 1 lifecycle/version migration", () => {
  beforeEach(async () => {
    await dropMigrationIndex();
    await clearMigrationCollections();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await dropMigrationIndex();
    await clearMigrationCollections();
  });

  it("reports a dry run without changing any document or index", async () => {
    const context = await insertLegacyGraph();
    await context.db
      .collection("stockmovements")
      .createIndex({ type: 1 }, { name: "movement_type_lookup" });
    const before = await captureMigrationState(context.db);

    const summary = await migrateDatabase({ db: context.db });

    expect(summary).toMatchObject({
      mode: "dry-run",
      products: { invalidVersions: 2 },
      warehouses: { invalidVersions: 1 },
      stocks: { updatesRequired: 2, orphanCount: 1 },
      stockMovements: {
        legacyIntegrityRows: 1,
        directReferenceBackfills: 1,
      },
      index: {
        existingName: null,
        alreadyPresent: false,
        wouldCreate: true,
        created: false,
        blockedByDuplicates: false,
        incompatible: false,
      },
    });
    expect(await captureMigrationState(context.db)).toEqual(before);
  });

  it("applies safe backfills, leaves historical facts absent, and is idempotent", async () => {
    const context = await insertLegacyGraph();

    const applied = await migrateDatabase({ db: context.db, apply: true });
    expect(applied.index.created).toBe(true);

    expect(
      await context.db.collection("products").findOne({ _id: context.productId })
    ).toMatchObject({ version: 1, status: "active" });
    expect(
      await context.db
        .collection("products")
        .findOne({ _id: context.archivedProductId })
    ).toMatchObject({ version: 1, status: "inactive" });
    expect(
      await context.db.collection("warehouses").findOne({ _id: context.warehouseId })
    ).toMatchObject({ version: 1, status: "inactive" });

    const migratedStock = await context.db
      .collection("stocks")
      .findOne({ _id: context.stockId });
    expect(migratedStock).toMatchObject({
      quantity: 7,
      version: 1,
      productLifecycleStatus: "archived",
      warehouseLifecycleStatus: "inactive",
    });

    const orphan = await context.db
      .collection("stocks")
      .findOne({ _id: context.orphanStockId });
    expect(orphan).toMatchObject({
      quantity: 2,
      version: 1,
      warehouseLifecycleStatus: "inactive",
    });
    expect(orphan).not.toHaveProperty("productLifecycleStatus");

    const movement = await context.db
      .collection("stockmovements")
      .findOne({ _id: context.movementId });
    expect(movement).toMatchObject({
      productId: context.archivedProductId,
      warehouseId: context.warehouseId,
    });
    expect(movement).not.toHaveProperty("quantityBefore");
    expect(movement).not.toHaveProperty("quantityAfter");
    expect(movement).not.toHaveProperty("aggregateVersion");
    expect(movement).not.toHaveProperty("productSnapshot");
    expect(movement).not.toHaveProperty("warehouseSnapshot");

    const afterFirstApply = await captureMigrationState(context.db);
    const rerun = await migrateDatabase({ db: context.db, apply: true });
    expect(rerun).toMatchObject({
      products: { invalidVersions: 0 },
      warehouses: { invalidVersions: 0 },
      stocks: { updatesRequired: 0, orphanCount: 1 },
      stockMovements: { directReferenceBackfills: 0 },
      index: {
        existingName: MOVEMENT_VERSION_INDEX,
        alreadyPresent: true,
        wouldCreate: false,
        created: false,
      },
    });
    expect(await captureMigrationState(context.db)).toEqual(afterFirstApply);
  });

  it("preflights duplicate aggregate versions before making any apply writes", async () => {
    const db = mongoose.connection.db;
    const productId = new mongoose.Types.ObjectId();
    const warehouseId = new mongoose.Types.ObjectId();
    const stockId = new mongoose.Types.ObjectId();
    await db.collection("products").insertOne({
      _id: productId,
      sku: "DUPLICATE-PREFLIGHT",
      name: "Duplicate Preflight",
      status: "active",
    });
    await db.collection("warehouses").insertOne({
      _id: warehouseId,
      code: "DUP-WH",
      name: "Duplicate Warehouse",
      status: "inactive",
      version: 0,
    });
    await db.collection("stocks").insertOne({
      _id: stockId,
      productId,
      warehouseId,
      quantity: 2,
      status: "active",
    });
    await db.collection("stockmovements").insertMany([
      {
        stockId,
        type: "GOODS_RECEIPT",
        quantity: 1,
        aggregateVersion: 2,
      },
      {
        stockId,
        type: "GOODS_RECEIPT",
        quantity: 1,
        aggregateVersion: 2,
      },
    ]);
    await db
      .collection("stockmovements")
      .createIndex({ type: 1 }, { name: "movement_type_lookup" });
    const before = await captureMigrationState(db);

    await expect(migrateDatabase({ db, apply: true })).rejects.toThrow(
      "Duplicate Stock/aggregateVersion candidates block safe index creation"
    );

    expect(await captureMigrationState(db)).toEqual(before);
    expect(
      await db.collection("stockmovements").countDocuments({
        stockId,
        aggregateVersion: 2,
      })
    ).toBe(2);
  });

  it("preserves every already-valid aggregate version", async () => {
    const db = mongoose.connection.db;
    const productId = new mongoose.Types.ObjectId();
    const warehouseId = new mongoose.Types.ObjectId();

    await db.collection("products").insertOne({
      _id: productId,
      sku: "VALID-VERSION",
      name: "Valid Product Version",
      status: "active",
      version: 4,
    });
    await db.collection("warehouses").insertOne({
      _id: warehouseId,
      code: "VALID-WH",
      name: "Valid Warehouse Version",
      status: "active",
      version: 7,
    });
    await db.collection("stocks").insertOne({
      productId,
      warehouseId,
      quantity: 3,
      status: "active",
      version: 9,
      productLifecycleStatus: "active",
      warehouseLifecycleStatus: "active",
    });

    await migrateDatabase({ db, apply: true });

    expect((await db.collection("products").findOne({ _id: productId })).version).toBe(4);
    expect((await db.collection("warehouses").findOne({ _id: warehouseId })).version).toBe(7);
    expect((await db.collection("stocks").findOne({ productId })).version).toBe(9);
  });

  it("recognizes the exact compatible index under its expected name", async () => {
    const db = mongoose.connection.db;
    await createCompatibleMovementIndex(db);

    const summary = await migrateDatabase({ db, apply: true });

    expect(summary.index).toMatchObject({
      existingName: MOVEMENT_VERSION_INDEX,
      alreadyPresent: true,
      wouldCreate: false,
      created: false,
      incompatible: false,
    });
    expect(
      (await listMovementIndexes(db)).filter(
        (index) => index.name === MOVEMENT_VERSION_INDEX
      )
    ).toHaveLength(1);
  });

  it("recognizes an exact compatible index under an alternate name", async () => {
    const db = mongoose.connection.db;
    const alternateName = "alternate_stock_aggregate_version_unique";
    await createCompatibleMovementIndex(db, alternateName);

    const summary = await migrateDatabase({ db, apply: true });

    expect(summary.index).toMatchObject({
      existingName: alternateName,
      alreadyPresent: true,
      wouldCreate: false,
      created: false,
      incompatible: false,
    });
    const indexes = await listMovementIndexes(db);
    expect(indexes.some((index) => index.name === MOVEMENT_VERSION_INDEX)).toBe(false);
    expect(indexes.filter((index) => index.name === alternateName)).toHaveLength(1);
  });

  it("rejects an incompatible expected-name index before any write", async () => {
    const db = mongoose.connection.db;
    await db.collection("products").insertOne({
      sku: "INCOMPATIBLE-NAME",
      name: "Incompatible Named Index",
      status: "active",
    });
    await db
      .collection("stockmovements")
      .createIndex({ stockId: 1 }, { name: MOVEMENT_VERSION_INDEX });
    const before = await captureMigrationState(db);

    await expect(migrateDatabase({ db, apply: true })).rejects.toThrow(
      "Incompatible StockMovement aggregate-version index blocks migration"
    );

    expect(await captureMigrationState(db)).toEqual(before);
  });

  it("rejects an incompatible exact-key index before any write", async () => {
    const db = mongoose.connection.db;
    await db.collection("products").insertOne({
      sku: "INCOMPATIBLE-KEY",
      name: "Incompatible Key Index",
      status: "active",
    });
    await db.collection("stockmovements").createIndex(MOVEMENT_VERSION_INDEX_KEY, {
      name: "non_unique_stock_aggregate_version",
    });
    const before = await captureMigrationState(db);

    await expect(migrateDatabase({ db, apply: true })).rejects.toThrow(
      "Incompatible StockMovement aggregate-version index blocks migration"
    );

    expect(await captureMigrationState(db)).toEqual(before);
  });

  it.each([
    ["missing partial filter", {}],
    [
      "wrong aggregateVersion type",
      { partialFilterExpression: { aggregateVersion: { $type: "string" } } },
    ],
    [
      "extra partial-filter condition",
      {
        partialFilterExpression: {
          aggregateVersion: { $type: "number" },
          type: { $exists: true },
        },
      },
    ],
  ])(
    "rejects exact target keys with %s before any write",
    async (_scenario, indexOptions) => {
      const context = await insertLegacyGraph();
      const incompatibleName = "incompatible_partial_filter";
      await context.db
        .collection("stockmovements")
        .createIndex(MOVEMENT_VERSION_INDEX_KEY, {
          name: incompatibleName,
          unique: true,
          ...indexOptions,
        });
      const before = await captureMigrationState(context.db);

      await expect(
        migrateDatabase({ db: context.db, apply: true })
      ).rejects.toThrow(
        "Incompatible StockMovement aggregate-version index blocks migration"
      );

      const after = await captureMigrationState(context.db);
      expect(after).toEqual(before);
      expect(
        after.movementIndexes.some(
          (index) => index.name === MOVEMENT_VERSION_INDEX
        )
      ).toBe(false);
      expect(
        after.movementIndexes.some((index) => index.name === incompatibleName)
      ).toBe(true);
    }
  );

  it("rejects an incompatible reserved-name index even when an equivalent alternate index exists", async () => {
    const context = await insertLegacyGraph();
    const alternateName = "alternate_stock_aggregate_version_unique";
    await createCompatibleMovementIndex(context.db, alternateName);
    await context.db
      .collection("stockmovements")
      .createIndex({ stockId: 1 }, { name: MOVEMENT_VERSION_INDEX });
    const before = await captureMigrationState(context.db);

    await expect(
      migrateDatabase({ db: context.db, apply: true })
    ).rejects.toThrow(
      "Incompatible StockMovement aggregate-version index blocks migration"
    );

    const after = await captureMigrationState(context.db);
    expect(after).toEqual(before);
    expect(
      after.movementIndexes.map((index) => index.name)
    ).toEqual(
      expect.arrayContaining([alternateName, MOVEMENT_VERSION_INDEX])
    );
  });

  it("accepts only the documented migration CLI arguments", async () => {
    const acceptedArgumentLists = [
      [[], { mode: "dry-run", apply: false }],
      [["--apply"], { mode: "apply", apply: true }],
    ];

    for (const [args, expectedOptions] of acceptedArgumentLists) {
      expect(parseMigrationArgs(args)).toEqual(expectedOptions);

      const executeMigration = jest.fn().mockResolvedValue(undefined);
      const logger = { log: jest.fn(), error: jest.fn() };
      const exitCode = await runMigrationCli({
        args,
        executeMigration,
        logger,
      });

      expect(exitCode).toBe(0);
      expect(executeMigration).toHaveBeenCalledTimes(1);
      expect(executeMigration).toHaveBeenCalledWith({
        apply: expectedOptions.apply,
        logger,
      });
    }

    const rejectedArgumentLists = [
      ["--unknown"],
      ["--apply", "--unknown"],
      ["--apply", "--apply"],
      ["apply"],
      ["--aply"],
      ["--dry-run"],
      [""],
      ["--apply", ""],
    ];

    for (const args of rejectedArgumentLists) {
      expect(() => parseMigrationArgs(args)).toThrow("Invalid migration arguments");

      const executeMigration = jest.fn();
      const logger = { log: jest.fn(), error: jest.fn() };
      const exitCode = await runMigrationCli({
        args,
        executeMigration,
        logger,
      });

      expect(exitCode).toBe(1);
      expect(executeMigration).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(CLI_USAGE);
    }
  });

  it("redacts credentials and query secrets from CLI failures", async () => {
    const sensitiveUri =
      "mongodb://migration-user:secret@example.invalid/db?authSource=admin&token=private";
    const createConnection = jest.fn().mockRejectedValue(
      new Error(`Connection failed for ${sensitiveUri}`)
    );
    const executeMigration = jest.fn((options) =>
      runMigration({ ...options, uri: sensitiveUri, createConnection })
    );
    const logger = { log: jest.fn(), error: jest.fn() };

    const exitCode = await runMigrationCli({
      args: ["--apply"],
      executeMigration,
      logger,
    });

    const output = JSON.stringify(logger.error.mock.calls);
    expect(exitCode).toBe(1);
    expect(createConnection).toHaveBeenCalledWith(sensitiveUri);
    expect(output).not.toContain(sensitiveUri);
    expect(output).not.toContain("migration-user");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("private");
    expect(logger.error).toHaveBeenCalledWith(
      "Lifecycle/version migration failed. Review safe migration diagnostics."
    );
  });

  it("redacts both primary and cleanup secrets when the CLI migration fails", async () => {
    const sensitiveUri =
      "mongodb://primary-user:primary-password@example.invalid/db?token=primary-token";
    const primaryError = new Error(`Primary failure for ${sensitiveUri}`);
    const cleanupError = new Error(
      "Cleanup failure for cleanup-user:cleanup-password?token=cleanup-token"
    );
    const fakeConnection = {
      db: {
        collection: jest.fn(() => {
          throw primaryError;
        }),
      },
      close: jest.fn().mockRejectedValue(cleanupError),
    };
    const executeMigration = jest.fn((options) =>
      runMigration({
        ...options,
        uri: sensitiveUri,
        createConnection: jest.fn().mockResolvedValue(fakeConnection),
      })
    );
    const logger = { log: jest.fn(), error: jest.fn() };

    const exitCode = await runMigrationCli({
      args: ["--apply"],
      executeMigration,
      logger,
    });

    const output = JSON.stringify(logger.error.mock.calls);
    expect(exitCode).toBe(1);
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
    expect(output).not.toContain(sensitiveUri);
    expect(output).not.toContain("primary-user");
    expect(output).not.toContain("primary-password");
    expect(output).not.toContain("primary-token");
    expect(output).not.toContain("cleanup-user");
    expect(output).not.toContain("cleanup-password");
    expect(output).not.toContain("cleanup-token");
    expect(output).not.toContain(primaryError.message);
    expect(output).not.toContain(cleanupError.message);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Lifecycle/version migration failed. Review safe migration diagnostics."
    );
  });

  it.each([
    ["dry-run", false],
    ["apply", true],
  ])(
    "returns successful %s only after closing and never logs the configured URI",
    async (_mode, apply) => {
      const events = [];
      const fakeConnection = {
        db: mongoose.connection.db,
        close: jest.fn(async () => {
          events.push("close");
        }),
      };
      const logger = {
        log: jest.fn(() => {
          events.push("log");
        }),
        error: jest.fn(),
      };
      const sensitiveUri =
        "mongodb://migration-user:secret@example.invalid/db";

      const result = await runMigration({
        uri: sensitiveUri,
        apply,
        logger,
        createConnection: jest.fn().mockResolvedValue(fakeConnection),
      });

      expect(fakeConnection.close).toHaveBeenCalledTimes(1);
      expect(events).toEqual(["close", "log"]);
      expect(result).toEqual(JSON.parse(logger.log.mock.calls[0][0]));
      expect(result.mode).toBe(apply ? "apply" : "dry-run");
      expect(logger.error).not.toHaveBeenCalled();
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain(sensitiveUri);
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("secret");
    }
  );

  it("preserves semantic index failure when cleanup also fails", async () => {
    const context = await insertLegacyGraph();
    await context.db
      .collection("stockmovements")
      .createIndex({ stockId: 1 }, { name: MOVEMENT_VERSION_INDEX });
    const before = await captureMigrationState(context.db);
    const cleanupError = new Error("Injected semantic cleanup failure");
    const fakeConnection = {
      db: context.db,
      close: jest.fn().mockRejectedValue(cleanupError),
    };
    const logger = { log: jest.fn(), error: jest.fn() };

    const observedError = await captureError(() =>
      runMigration({
        uri: "mongodb://safe.example.invalid/test",
        apply: true,
        logger,
        createConnection: jest.fn().mockResolvedValue(fakeConnection),
      })
    );

    expect(observedError).toMatchObject({
      message:
      "Incompatible StockMovement aggregate-version index blocks migration"
    });
    expect(observedError).not.toBe(cleanupError);
    expect(observedError.migrationSummary).toBeDefined();
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(await captureMigrationState(context.db)).toEqual(before);
  });

  it("preserves duplicate preflight failure when cleanup also fails", async () => {
    const context = await insertDuplicateMovementVersions();
    const before = await captureMigrationState(context.db);
    const cleanupError = new Error("Injected duplicate cleanup failure");
    const fakeConnection = {
      db: context.db,
      close: jest.fn().mockRejectedValue(cleanupError),
    };
    const logger = { log: jest.fn(), error: jest.fn() };

    const observedError = await captureError(() =>
      runMigration({
        uri: "mongodb://safe.example.invalid/test",
        apply: true,
        logger,
        createConnection: jest.fn().mockResolvedValue(fakeConnection),
      })
    );

    expect(observedError).toMatchObject({
      message:
        "Duplicate Stock/aggregateVersion candidates block safe index creation",
    });
    expect(observedError).not.toBe(cleanupError);
    expect(observedError.migrationSummary).toBeDefined();
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(await captureMigrationState(context.db)).toEqual(before);
  });

  it.each(["semantic index", "duplicate aggregate version"])(
    "prints only the stable CLI failure for %s preflight plus cleanup failure",
    async (scenario) => {
      const context =
        scenario === "semantic index"
          ? await insertLegacyGraph()
          : await insertDuplicateMovementVersions();

      if (scenario === "semantic index") {
        await context.db
          .collection("stockmovements")
          .createIndex({ stockId: 1 }, { name: MOVEMENT_VERSION_INDEX });
      }

      const before = await captureMigrationState(context.db);
      const fakeConnection = {
        db: context.db,
        close: jest.fn().mockRejectedValue(
          new Error(
            "cleanup-user:cleanup-password?token=cleanup-token"
          )
        ),
      };
      const logger = { log: jest.fn(), error: jest.fn() };
      const executeMigration = (options) =>
        runMigration({
          ...options,
          uri: "mongodb://primary-user:primary-password@example.invalid/db?token=primary-token",
          createConnection: jest.fn().mockResolvedValue(fakeConnection),
        });

      const exitCode = await runMigrationCli({
        args: ["--apply"],
        executeMigration,
        logger,
      });

      expect(exitCode).toBe(1);
      expect(fakeConnection.close).toHaveBeenCalledTimes(1);
      expect(logger.log).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        "Lifecycle/version migration failed. Review safe migration diagnostics."
      );
      const output = JSON.stringify(logger.error.mock.calls);
      expect(output).not.toContain("primary-user");
      expect(output).not.toContain("primary-password");
      expect(output).not.toContain("primary-token");
      expect(output).not.toContain("cleanup-user");
      expect(output).not.toContain("cleanup-password");
      expect(output).not.toContain("cleanup-token");
      expect(await captureMigrationState(context.db)).toEqual(before);
    }
  );

  it("closes its connection and preserves the original post-connect failure", async () => {
    const originalError = new Error("Injected post-connect migration failure");
    const fakeConnection = {
      db: {
        collection: jest.fn(() => {
          throw originalError;
        }),
      },
      close: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { log: jest.fn(), error: jest.fn() };
    let observedError;

    try {
      await runMigration({
        uri: "mongodb://migration-user:secret@example.invalid/db",
        apply: true,
        logger,
        createConnection: jest.fn().mockResolvedValue(fakeConnection),
      });
    } catch (error) {
      observedError = error;
    }

    expect(observedError).toBe(originalError);
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
  });

  it("preserves the primary error when migration and cleanup both fail", async () => {
    const primaryError = new Error("Injected primary migration failure");
    primaryError.code = "PRIMARY_FAILURE";
    primaryError.customField = { retained: true };
    const cleanupError = new Error("Injected cleanup failure");
    const fakeConnection = {
      db: {
        collection: jest.fn(() => {
          throw primaryError;
        }),
      },
      close: jest.fn().mockRejectedValue(cleanupError),
    };

    const observedError = await captureError(() =>
      runMigration({
        uri: "mongodb://safe.example.invalid/test",
        apply: true,
        logger: { log: jest.fn(), error: jest.fn() },
        createConnection: jest.fn().mockResolvedValue(fakeConnection),
      })
    );

    expect(observedError).toBe(primaryError);
    expect(observedError).not.toBe(cleanupError);
    expect(observedError.code).toBe("PRIMARY_FAILURE");
    expect(observedError.customField).toBe(primaryError.customField);
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
  });

  it("returns the cleanup error when migration succeeds but cleanup fails", async () => {
    const cleanupError = new Error("Injected cleanup-only failure");
    const logger = { log: jest.fn(), error: jest.fn() };
    const fakeConnection = {
      db: mongoose.connection.db,
      close: jest.fn().mockRejectedValue(cleanupError),
    };

    const observedError = await captureError(() =>
      runMigration({
        uri: "mongodb://safe.example.invalid/test",
        apply: false,
        logger,
        createConnection: jest.fn().mockResolvedValue(fakeConnection),
      })
    );

    expect(observedError).toBe(cleanupError);
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("preserves a data-write failure over cleanup failure and remains rerunnable", async () => {
    const context = await insertLegacyGraph();
    const primaryError = new Error("Injected Warehouse update failure");
    const cleanupError = new Error("Injected cleanup failure after data write");
    const originalCollection = context.db.collection.bind(context.db);
    const warehousesCollection = originalCollection("warehouses");
    jest
      .spyOn(context.db, "collection")
      .mockImplementation((name, options) =>
        name === "warehouses"
          ? warehousesCollection
          : originalCollection(name, options)
      );
    jest
      .spyOn(warehousesCollection, "updateMany")
      .mockRejectedValueOnce(primaryError);
    const fakeConnection = {
      db: context.db,
      close: jest.fn().mockRejectedValue(cleanupError),
    };

    const observedError = await captureError(() =>
      runMigration({
        uri: "mongodb://safe.example.invalid/test",
        apply: true,
        logger: { log: jest.fn(), error: jest.fn() },
        createConnection: jest.fn().mockResolvedValue(fakeConnection),
      })
    );

    expect(observedError).toBe(primaryError);
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
    expect(
      await context.db.collection("products").findOne({ _id: context.productId })
    ).toMatchObject({ version: 1 });
    expect(
      await context.db
        .collection("warehouses")
        .findOne({ _id: context.warehouseId })
    ).toMatchObject({ version: 1.5 });
    expect(
      (await listMovementIndexes(context.db)).some(
        (index) => index.name === MOVEMENT_VERSION_INDEX
      )
    ).toBe(false);

    const rerun = await migrateDatabase({ db: context.db, apply: true });
    expect(rerun.index.created).toBe(true);
    expect(
      await context.db
        .collection("warehouses")
        .findOne({ _id: context.warehouseId })
    ).toMatchObject({ version: 1 });
  });

  it("preserves an index-creation failure over cleanup failure and remains rerunnable", async () => {
    const context = await insertLegacyGraph();
    await context.db
      .collection("stockmovements")
      .createIndex({ type: 1 }, { name: "movement_type_lookup" });
    const primaryError = new Error("Injected index creation failure");
    const cleanupError = new Error("Injected cleanup failure after index create");
    const originalCollection = context.db.collection.bind(context.db);
    const movementsCollection = originalCollection("stockmovements");
    jest
      .spyOn(context.db, "collection")
      .mockImplementation((name, options) =>
        name === "stockmovements"
          ? movementsCollection
          : originalCollection(name, options)
      );
    jest
      .spyOn(movementsCollection, "createIndex")
      .mockRejectedValueOnce(primaryError);
    const fakeConnection = {
      db: context.db,
      close: jest.fn().mockRejectedValue(cleanupError),
    };

    const observedError = await captureError(() =>
      runMigration({
        uri: "mongodb://safe.example.invalid/test",
        apply: true,
        logger: { log: jest.fn(), error: jest.fn() },
        createConnection: jest.fn().mockResolvedValue(fakeConnection),
      })
    );

    expect(observedError).toBe(primaryError);
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
    expect(
      await context.db.collection("products").findOne({ _id: context.productId })
    ).toMatchObject({ version: 1 });
    expect(
      await context.db.collection("stocks").findOne({ _id: context.stockId })
    ).toMatchObject({
      version: 1,
      productLifecycleStatus: "archived",
      warehouseLifecycleStatus: "inactive",
    });
    expect(
      await context.db
        .collection("stockmovements")
        .findOne({ _id: context.movementId })
    ).toMatchObject({
      productId: context.archivedProductId,
      warehouseId: context.warehouseId,
    });
    let indexes = await listMovementIndexes(context.db);
    expect(indexes.some((index) => index.name === MOVEMENT_VERSION_INDEX)).toBe(
      false
    );
    expect(indexes.some((index) => index.name === "movement_type_lookup")).toBe(
      true
    );

    const rerun = await migrateDatabase({ db: context.db, apply: true });
    expect(rerun.index.created).toBe(true);
    indexes = await listMovementIndexes(context.db);
    expect(indexes.some((index) => index.name === MOVEMENT_VERSION_INDEX)).toBe(
      true
    );
    expect(indexes.some((index) => index.name === "movement_type_lookup")).toBe(
      true
    );
  });
});
