const {
  COLLECTIONS,
  INDEX_DEFINITIONS,
  classifyDefinition,
  migrateDatabase,
  parseMigrationArgs,
  runMigration,
  runMigrationCli,
} = require("../scripts/migrations/phase1AuditOutboxIndexes");

require("./setupTestDb");

const mongoose = require("mongoose");

const dropEventCollections = async () => {
  const existing = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(existing.map(({ name }) => name));
  for (const name of Object.values(COLLECTIONS)) {
    if (names.has(name)) await mongoose.connection.db.collection(name).drop();
  }
};

describe("audit/outbox controlled index migration", () => {
  beforeEach(dropEventCollections);

  it("accepts only the exact dry-run and apply CLI arguments before connection", async () => {
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
      expect(() => parseMigrationArgs(args)).toThrow();
      const executeMigration = jest.fn();
      const logger = { error: jest.fn() };
      expect(await runMigrationCli({ args, executeMigration, logger })).toBe(1);
      expect(executeMigration).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "Usage: npm run migrate:phase1-audit-outbox [-- --apply]"
      );
    }
  });

  it("is dry-run by default, creates all indexes only on apply, and reruns idempotently", async () => {
    const dryRun = await migrateDatabase({ db: mongoose.connection.db });
    expect(Object.values(dryRun.indexes).every(({ wouldCreate }) => wouldCreate)).toBe(true);
    expect(
      await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()
    ).toEqual([]);

    const applied = await migrateDatabase({ db: mongoose.connection.db, apply: true });
    expect(Object.values(applied.indexes).every(({ created }) => created)).toBe(true);
    const indexesAfterApply = {};
    for (const collection of Object.values(COLLECTIONS)) {
      indexesAfterApply[collection] = await mongoose.connection.db
        .collection(collection)
        .listIndexes()
        .toArray();
    }
    const existingDryRun = await migrateDatabase({ db: mongoose.connection.db });
    expect(
      Object.values(existingDryRun.indexes).every(({ alreadyPresent }) =>
        alreadyPresent
      )
    ).toBe(true);
    for (const collection of Object.values(COLLECTIONS)) {
      expect(
        await mongoose.connection.db.collection(collection).listIndexes().toArray()
      ).toEqual(indexesAfterApply[collection]);
    }
    const rerun = await migrateDatabase({ db: mongoose.connection.db, apply: true });
    expect(Object.values(rerun.indexes).every(({ alreadyPresent }) => alreadyPresent)).toBe(true);
    expect(Object.values(rerun.indexes).every(({ created }) => !created)).toBe(true);

    for (const collection of Object.values(COLLECTIONS)) {
      const indexes = await mongoose.connection.db.collection(collection).listIndexes().toArray();
      expect(indexes.some((index) => index.expireAfterSeconds !== undefined)).toBe(false);
    }
  });

  it.each([
    ["wrong order", { key: { occurredAt: -1, correlationId: 1 } }],
    ["wrong direction", { key: { correlationId: 1, occurredAt: 1 } }],
    ["unique", { unique: true }],
    ["prepareUnique", { prepareUnique: true }],
    ["sparse", { sparse: true }],
    ["partial", { partialFilterExpression: { correlationId: { $exists: true } } }],
    ["collation", { collation: { locale: "en" } }],
    ["hidden", { hidden: true }],
    ["TTL", { expireAfterSeconds: 10 }],
  ])("rejects %s semantics", (label, override) => {
    const definition = INDEX_DEFINITIONS.find(
      ({ name }) => name === "idx_audit_correlation_occurred_at"
    );
    const candidate = {
      name: definition.name,
      key: definition.key,
      ...override,
    };
    expect(classifyDefinition({ indexes: [candidate], definition })).toMatchObject({
      state: "incompatible",
    });
  });

  it("accepts a compatible alternate name but rejects a bad reserved name beside it", () => {
    const definition = INDEX_DEFINITIONS.find(
      ({ name }) => name === "uq_outbox_event_id"
    );
    const alternate = { name: "alternate_event_id", key: definition.key, unique: true };
    expect(classifyDefinition({ indexes: [alternate], definition })).toEqual({
      state: "present",
      existingName: "alternate_event_id",
    });
    expect(
      classifyDefinition({
        indexes: [alternate, { name: definition.name, key: { wrong: 1 } }],
        definition,
      })
    ).toMatchObject({ state: "incompatible", existingName: definition.name });
  });

  it("rejects missing unique semantics on required unique indexes", () => {
    const definition = INDEX_DEFINITIONS.find(
      ({ name }) => name === "uq_outbox_aggregate_version"
    );
    expect(
      classifyDefinition({
        indexes: [{ name: definition.name, key: definition.key }],
        definition,
      })
    ).toMatchObject({ state: "incompatible" });
  });

  it.each([
    [
      "duplicate AuditEvent IDs",
      [
        { auditEventId: "duplicate-audit" },
        { auditEventId: "duplicate-audit" },
      ],
      [
        {
          eventId: "unique-outbox",
          aggregate: { type: "Stock", id: "stock-1", version: 1 },
        },
      ],
    ],
    [
      "duplicate Outbox event IDs",
      [{ auditEventId: "unique-audit" }],
      [
        {
          eventId: "duplicate-outbox",
          aggregate: { type: "Stock", id: "stock-1", version: 1 },
        },
        {
          eventId: "duplicate-outbox",
          aggregate: { type: "Stock", id: "stock-2", version: 1 },
        },
      ],
    ],
    [
      "duplicate Outbox aggregate versions",
      [{ auditEventId: "unique-audit" }],
      [
        {
          eventId: "outbox-1",
          aggregate: { type: "Stock", id: "stock-1", version: 2 },
        },
        {
          eventId: "outbox-2",
          aggregate: { type: "Stock", id: "stock-1", version: 2 },
        },
      ],
    ],
  ])("preflights %s before creating any required index", async (label, audits, outboxes) => {
    const db = mongoose.connection.db;
    await db.collection(COLLECTIONS.audit).insertMany(audits);
    await db.collection(COLLECTIONS.outbox).insertMany(outboxes);
    const documentsBefore = {
      audit: await db.collection(COLLECTIONS.audit).find({}).toArray(),
      outbox: await db.collection(COLLECTIONS.outbox).find({}).toArray(),
    };
    const indexesBefore = {
      audit: await db.collection(COLLECTIONS.audit).listIndexes().toArray(),
      outbox: await db.collection(COLLECTIONS.outbox).listIndexes().toArray(),
    };

    await expect(migrateDatabase({ db, apply: true })).rejects.toThrow(
      "Duplicate event identities"
    );
    expect(await db.collection(COLLECTIONS.audit).listIndexes().toArray()).toEqual(
      indexesBefore.audit
    );
    expect(await db.collection(COLLECTIONS.outbox).listIndexes().toArray()).toEqual(
      indexesBefore.outbox
    );
    expect(await db.collection(COLLECTIONS.audit).find({}).toArray()).toEqual(
      documentsBefore.audit
    );
    expect(await db.collection(COLLECTIONS.outbox).find({}).toArray()).toEqual(
      documentsBefore.outbox
    );
  });

  it("rejects unrelated TTL and preserves primary/cleanup failure ordering", async () => {
    await mongoose.connection.db.collection(COLLECTIONS.audit).createIndex(
      { expiresAt: 1 },
      { name: "unrelated_ttl", expireAfterSeconds: 0 }
    );
    await expect(
      migrateDatabase({ db: mongoose.connection.db, apply: true })
    ).rejects.toThrow("Incompatible audit/outbox indexes");

    const primary = new Error("fake-primary-secret");
    const cleanup = new Error("fake-cleanup-secret");
    const connection = {
      get db() {
        throw primary;
      },
      close: jest.fn().mockRejectedValue(cleanup),
    };
    await expect(
      runMigration({
        uri: "mongodb://fake-user:fake-password@example.invalid/db?token=fake",
        createConnection: jest.fn().mockResolvedValue(connection),
        logger: { log: jest.fn() },
      })
    ).rejects.toBe(primary);
    expect(connection.close).toHaveBeenCalledTimes(1);

    await dropEventCollections();
    const successfulConnection = {
      db: mongoose.connection.db,
      close: jest.fn().mockRejectedValue(cleanup),
    };
    await expect(
      runMigration({
        uri: "mongodb://example.invalid/db",
        createConnection: jest.fn().mockResolvedValue(successfulConnection),
        logger: { log: jest.fn() },
      })
    ).rejects.toBe(cleanup);
    expect(successfulConnection.close).toHaveBeenCalledTimes(1);
  });

  it("is rerunnable after a partial index-creation failure", async () => {
    const db = mongoose.connection.db;
    const originalCollection = db.collection.bind(db);
    let injected = false;
    const spy = jest
      .spyOn(db, "collection")
      .mockImplementation((name, options) => {
        const collection = originalCollection(name, options);
        if (name === COLLECTIONS.audit) {
          const originalCreateIndex = collection.createIndex.bind(collection);
          collection.createIndex = async (key, indexOptions) => {
            if (
              !injected &&
              indexOptions.name === "idx_audit_correlation_occurred_at"
            ) {
              injected = true;
              throw new Error("injected partial create failure");
            }
            return originalCreateIndex(key, indexOptions);
          };
        }
        return collection;
      });

    await expect(
      migrateDatabase({ db: mongoose.connection.db, apply: true })
    ).rejects.toThrow("injected partial create failure");
    spy.mockRestore();

    const rerun = await migrateDatabase({
      db: mongoose.connection.db,
      apply: true,
    });
    expect(
      Object.values(rerun.indexes).every(
        ({ alreadyPresent, created }) => alreadyPresent || created
      )
    ).toBe(true);
  });

  it("redacts credentials and raw internal errors from CLI output", async () => {
    const logger = { error: jest.fn() };
    const executeMigration = jest
      .fn()
      .mockRejectedValue(
        new Error(
          "mongodb://fake-user:fake-password@example.invalid/db?token=fake-token"
        )
      );
    expect(
      await runMigrationCli({
        args: ["--apply"],
        executeMigration,
        logger,
      })
    ).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Audit/outbox index migration failed. Review safe migration diagnostics."
    );
    const output = logger.error.mock.calls.flat().join(" ");
    expect(output).not.toMatch(/fake-user|fake-password|fake-token|mongodb:\/\//);
  });
});
