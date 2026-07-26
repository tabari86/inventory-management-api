const mongoose = require("mongoose");

const {
  COLLECTION_NAME,
  TTL_INDEX_KEY,
  TTL_INDEX_NAME,
  UNIQUE_INDEX_KEY,
  UNIQUE_INDEX_NAME,
  classifyIndexes,
  migrateDatabase,
  parseMigrationArgs,
  runMigration,
  runMigrationCli,
} = require("../scripts/migrations/phase1IdempotencyIndexes");

require("./setupTestDb");

const collectionExists = async () =>
  (
    await mongoose.connection.db
      .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
      .toArray()
  ).length === 1;

const resetCollection = async () => {
  if (await collectionExists()) {
    await mongoose.connection.db.collection(COLLECTION_NAME).drop();
  }
};

const exactUniqueIndex = (name = UNIQUE_INDEX_NAME, overrides = {}) => ({
  name,
  key: UNIQUE_INDEX_KEY,
  unique: true,
  ...overrides,
});

const exactTtlIndex = (name = TTL_INDEX_NAME, overrides = {}) => ({
  name,
  key: TTL_INDEX_KEY,
  expireAfterSeconds: 0,
  ...overrides,
});

describe("Phase 1 idempotency index migration", () => {
  beforeEach(resetCollection);
  afterEach(async () => {
    jest.restoreAllMocks();
    await resetCollection();
  });

  it("is dry-run by default and performs no collection, index, or document write", async () => {
    const result = await migrateDatabase({ db: mongoose.connection.db });

    expect(result.mode).toBe("dry-run");
    expect(result.collectionExists).toBe(false);
    expect(result.indexes.unique.wouldCreate).toBe(true);
    expect(result.indexes.ttl.wouldCreate).toBe(true);
    expect(await collectionExists()).toBe(false);
  });

  it("apply creates the exact unique and TTL indexes and a second apply is idempotent", async () => {
    const first = await migrateDatabase({ db: mongoose.connection.db, apply: true });
    const indexesAfterFirst = await mongoose.connection.db
      .collection(COLLECTION_NAME)
      .listIndexes()
      .toArray();
    const second = await migrateDatabase({ db: mongoose.connection.db, apply: true });

    expect(first.indexes.unique.created).toBe(true);
    expect(first.indexes.ttl.created).toBe(true);
    expect(indexesAfterFirst).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: UNIQUE_INDEX_NAME,
          key: UNIQUE_INDEX_KEY,
          unique: true,
        }),
        expect.objectContaining({
          name: TTL_INDEX_NAME,
          key: TTL_INDEX_KEY,
          expireAfterSeconds: 0,
        }),
      ])
    );
    expect(second.indexes.unique.alreadyPresent).toBe(true);
    expect(second.indexes.ttl.alreadyPresent).toBe(true);
    expect(second.indexes.unique.created).toBe(false);
    expect(second.indexes.ttl.created).toBe(false);
  });

  it("reruns safely after a partial index-creation failure", async () => {
    const originalCreateIndex = mongoose.mongo.Collection.prototype.createIndex;
    jest
      .spyOn(mongoose.mongo.Collection.prototype, "createIndex")
      .mockImplementation(function createIndexWithInjectedFailure(key, options) {
        if (
          this.collectionName === COLLECTION_NAME &&
          options.name === TTL_INDEX_NAME
        ) {
          return Promise.reject(new Error("Injected TTL creation failure"));
        }
        return originalCreateIndex.call(this, key, options);
      });

    await expect(
      migrateDatabase({ db: mongoose.connection.db, apply: true })
    ).rejects.toThrow("Injected TTL creation failure");
    mongoose.mongo.Collection.prototype.createIndex.mockRestore();

    const rerun = await migrateDatabase({
      db: mongoose.connection.db,
      apply: true,
    });
    expect(rerun.indexes.unique.alreadyPresent).toBe(true);
    expect(rerun.indexes.ttl.created).toBe(true);
  });

  it("accepts semantically correct indexes under alternate names", async () => {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    await collection.createIndex(UNIQUE_INDEX_KEY, {
      name: "alternate_scope_unique",
      unique: true,
    });
    await collection.createIndex(TTL_INDEX_KEY, {
      name: "alternate_expiry_ttl",
      expireAfterSeconds: 0,
    });

    const result = await migrateDatabase({ db: mongoose.connection.db, apply: true });
    const names = (await collection.listIndexes().toArray()).map(({ name }) => name);

    expect(result.indexes.unique.existingName).toBe("alternate_scope_unique");
    expect(result.indexes.ttl.existingName).toBe("alternate_expiry_ttl");
    expect(names).not.toContain(UNIQUE_INDEX_NAME);
    expect(names).not.toContain(TTL_INDEX_NAME);
  });

  it.each([
    ["expected name", exactTtlIndex()],
    ["alternate name", exactTtlIndex("alternate_ttl")],
    [
      "explicit simple collation",
      exactTtlIndex("simple_collation_ttl", {
        collation: { locale: "simple" },
      }),
    ],
  ])("accepts an exact TTL index with %s", (label, index) => {
    expect(classifyIndexes([index]).ttl).toEqual({
      state: "present",
      existingName: index.name,
    });
  });

  it.each([
    ["unique option under the expected name", exactTtlIndex(TTL_INDEX_NAME, { unique: true })],
    ["unique option under an alternate name", exactTtlIndex("alternate_unique_ttl", { unique: true })],
    ["prepareUnique option", exactTtlIndex("prepared_ttl", { prepareUnique: true })],
    ["descending key", exactTtlIndex("descending_ttl", { key: { expiresAt: -1 } })],
    ["wrong expiry", exactTtlIndex("wrong_expiry", { expireAfterSeconds: 60 })],
    ["compound key", exactTtlIndex("compound_ttl", { key: { expiresAt: 1, actorId: 1 } })],
    ["sparse option", exactTtlIndex("sparse_ttl", { sparse: true })],
    [
      "partial filter",
      exactTtlIndex("partial_ttl", {
        partialFilterExpression: { state: "completed" },
      }),
    ],
    [
      "non-simple collation",
      exactTtlIndex("collated_ttl", { collation: { locale: "en" } }),
    ],
    [
      "reserved name with another key",
      { name: TTL_INDEX_NAME, key: { retentionMarker: 1 } },
    ],
  ])("rejects a TTL index with %s", (label, index) => {
    expect(classifyIndexes([index]).ttl).toEqual({
      state: "incompatible",
      existingName: index.name,
    });
  });

  it.each([
    ["expected name", exactUniqueIndex()],
    ["alternate name", exactUniqueIndex("alternate_unique")],
    [
      "explicit simple collation",
      exactUniqueIndex("simple_collation_unique", {
        collation: { locale: "simple" },
      }),
    ],
  ])("accepts an exact unique scope index with %s", (label, index) => {
    expect(classifyIndexes([index]).unique).toEqual({
      state: "present",
      existingName: index.name,
    });
  });

  it.each([
    [
      "wrong field order",
      exactUniqueIndex("wrong_order", {
        key: { actorId: 1, actorType: 1, operationId: 1, keyHash: 1 },
      }),
    ],
    [
      "wrong field direction",
      exactUniqueIndex("wrong_direction", {
        key: { actorType: 1, actorId: 1, operationId: -1, keyHash: 1 },
      }),
    ],
    ["unique false", exactUniqueIndex("not_unique", { unique: false })],
    ["prepareUnique", exactUniqueIndex("prepared_unique", { prepareUnique: true })],
    ["sparse option", exactUniqueIndex("sparse_unique", { sparse: true })],
    [
      "partial filter",
      exactUniqueIndex("partial_unique", {
        partialFilterExpression: { actorType: "user" },
      }),
    ],
    [
      "non-simple collation",
      exactUniqueIndex("collated_unique", { collation: { locale: "en" } }),
    ],
    [
      "reserved name with another key",
      { name: UNIQUE_INDEX_NAME, key: { legacyScope: 1 }, unique: true },
    ],
  ])("rejects a unique scope index with %s", (label, index) => {
    expect(classifyIndexes([index]).unique).toEqual({
      state: "incompatible",
      existingName: index.name,
    });
  });

  it.each([
    [
      "unique",
      async (collection) => {
        await collection.createIndex(UNIQUE_INDEX_KEY, {
          name: "alternate_scope_unique",
          unique: true,
        });
        await collection.createIndex({ legacyScope: 1 }, {
          name: UNIQUE_INDEX_NAME,
          unique: true,
        });
      },
    ],
    [
      "TTL",
      async (collection) => {
        await collection.createIndex(TTL_INDEX_KEY, {
          name: "alternate_expiry_ttl",
          expireAfterSeconds: 0,
        });
        await collection.createIndex(
          { retentionMarker: 1 },
          { name: TTL_INDEX_NAME }
        );
      },
    ],
  ])(
    "rejects a correct alternate %s index plus a bad reserved-name index before any change",
    async (label, createIndexes) => {
      const collection = mongoose.connection.db.collection(COLLECTION_NAME);
      await createIndexes(collection);
      const indexesBefore = await collection.listIndexes().toArray();

      await expect(
        migrateDatabase({ db: mongoose.connection.db, apply: true })
      ).rejects.toThrow("Incompatible idempotency index blocks migration");

      expect(await collection.listIndexes().toArray()).toEqual(indexesBefore);
    }
  );

  it.each([
    [
      "reserved unique name with wrong semantics",
      async (collection) =>
        collection.createIndex({ actorType: 1 }, { name: UNIQUE_INDEX_NAME }),
    ],
    [
      "wrong unique key order",
      async (collection) =>
        collection.createIndex(
          { actorId: 1, actorType: 1, operationId: 1, keyHash: 1 },
          { name: "wrong_order", unique: true }
        ),
    ],
    [
      "wrong unique option",
      async (collection) =>
        collection.createIndex(UNIQUE_INDEX_KEY, {
          name: "not_unique",
          unique: false,
        }),
    ],
    [
      "partial unique scope",
      async (collection) =>
        collection.createIndex(UNIQUE_INDEX_KEY, {
          name: "partial_unique",
          unique: true,
          partialFilterExpression: { actorType: "user" },
        }),
    ],
    [
      "sparse unique scope",
      async (collection) =>
        collection.createIndex(UNIQUE_INDEX_KEY, {
          name: "sparse_unique",
          unique: true,
          sparse: true,
        }),
    ],
    [
      "wrong TTL seconds",
      async (collection) =>
        collection.createIndex(TTL_INDEX_KEY, {
          name: "wrong_ttl",
          expireAfterSeconds: 60,
        }),
    ],
  ])("rejects an incompatible %s without dropping it", async (label, createIndex) => {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    await createIndex(collection);
    const before = await collection.listIndexes().toArray();

    await expect(
      migrateDatabase({ db: mongoose.connection.db, apply: true })
    ).rejects.toThrow("Incompatible idempotency index blocks migration");

    expect(await collection.listIndexes().toArray()).toEqual(before);
  });

  it("classifies a compound TTL definition as incompatible", () => {
    expect(
      classifyIndexes([
        {
          name: "compound_ttl",
          key: { expiresAt: 1, actorId: 1 },
          expireAfterSeconds: 0,
        },
      ]).ttl.state
    ).toBe("incompatible");
  });

  it("blocks duplicate valid scopes without modifying or deleting documents", async () => {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    const scope = {
      actorType: "user",
      actorId: "64b64c6f2f0f000000000001",
      operationId: "catalog.product.create.v1",
      keyHash: "a".repeat(64),
    };
    await collection.insertMany([
      { ...scope, marker: 1 },
      { ...scope, marker: 2 },
    ]);

    const documentsBefore = await collection.find({}).sort({ _id: 1 }).toArray();
    const indexesBefore = await collection.listIndexes().toArray();
    const dryRun = await migrateDatabase({ db: mongoose.connection.db });
    expect(dryRun.duplicateScopeCount).toBe(1);
    await expect(
      migrateDatabase({ db: mongoose.connection.db, apply: true })
    ).rejects.toThrow("Duplicate idempotency scopes");
    expect(await collection.find({}).sort({ _id: 1 }).toArray()).toEqual(
      documentsBefore
    );
    expect(await collection.listIndexes().toArray()).toEqual(indexesBefore);
    expect(indexesBefore.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([UNIQUE_INDEX_NAME, TTL_INDEX_NAME])
    );
  });

  it("accepts only the documented argument arrays", () => {
    expect(parseMigrationArgs([])).toEqual({ mode: "dry-run", apply: false });
    expect(parseMigrationArgs(["--apply"])).toEqual({ mode: "apply", apply: true });
    for (const args of [
      ["--unknown"],
      ["--apply", "--unknown"],
      ["--apply", "--apply"],
      ["apply"],
      ["--aply"],
      ["--dry-run"],
      [""],
      ["--apply", ""],
    ]) {
      expect(() => parseMigrationArgs(args)).toThrow("Invalid migration arguments");
    }
  });

  it("rejects invalid CLI input before execution and never leaks fake credentials", async () => {
    const executeMigration = jest.fn();
    const logger = { log: jest.fn(), error: jest.fn() };
    const exitCode = await runMigrationCli({
      args: ["--unknown"],
      executeMigration,
      logger,
    });

    expect(exitCode).toBe(1);
    expect(executeMigration).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Usage: npm run migrate:phase1-idempotency [-- --apply]"
    );

    const secret =
      "mongodb://migration-user:secret@example.invalid/db?token=private";
    const failingLogger = { log: jest.fn(), error: jest.fn() };
    await runMigrationCli({
      args: [],
      executeMigration: async () => {
        throw new Error(secret);
      },
      logger: failingLogger,
    });
    expect(JSON.stringify(failingLogger.error.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(failingLogger.error.mock.calls)).not.toContain("secret");
  });

  it("closes once and preserves primary failure over cleanup failure", async () => {
    const primary = new Error("primary");
    const close = jest.fn().mockRejectedValue(new Error("cleanup"));
    const createConnection = jest.fn().mockResolvedValue({
      db: {
        listCollections: () => {
          throw primary;
        },
      },
      close,
    });

    await expect(
      runMigration({
        uri: "mongodb://fake.invalid/db",
        logger: { log: jest.fn() },
        createConnection,
      })
    ).rejects.toBe(primary);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns cleanup failure after a successful migration", async () => {
    const cleanup = new Error("cleanup");
    const close = jest.fn().mockRejectedValue(cleanup);
    const createConnection = jest.fn().mockResolvedValue({
      db: {
        databaseName: "fake",
        listCollections: () => ({ toArray: async () => [] }),
      },
      close,
    });

    await expect(
      runMigration({
        uri: "mongodb://fake.invalid/db",
        logger: { log: jest.fn() },
        createConnection,
      })
    ).rejects.toBe(cleanup);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
