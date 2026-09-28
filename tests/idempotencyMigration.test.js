const mongoose = require("mongoose");

const {
  CLI_USAGE,
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

const collectionExists = async (name = COLLECTION_NAME) =>
  (
    await mongoose.connection.db
      .listCollections({ name }, { nameOnly: true })
      .toArray()
  ).length === 1;

const resetCollections = async () => {
  for (const name of [COLLECTION_NAME, "auditevents", "outboxevents"]) {
    if (await collectionExists(name)) {
      await mongoose.connection.db.collection(name).drop();
    }
  }
};

const ABSENT_EXPIRES_AT = Symbol("absent-expires-at");
let processingSequence = 0;

const rawProcessingRecord = ({
  id = new mongoose.Types.ObjectId(),
  expiresAt = ABSENT_EXPIRES_AT,
  ...overrides
} = {}) => {
  processingSequence += 1;
  const suffix = processingSequence.toString(16).padStart(4, "0");
  const record = {
    _id: id,
    actorType: "user",
    actorId: "64b64c6f2f0f000000000001",
    operationId: `test.processing.${suffix}.v1`,
    keyHash: suffix.padStart(64, "a"),
    requestHash: suffix.padStart(64, "b"),
    requestHashVersion: "canonical-json-v1",
    state: "processing",
    originalRequestId: `processing-request-${suffix}`,
    originalCorrelationId: `processing-correlation-${suffix}`,
    source: "http-api",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };

  if (expiresAt !== ABSENT_EXPIRES_AT) record.expiresAt = expiresAt;
  return record;
};

const captureCollectionState = async () => {
  if (!(await collectionExists())) {
    return { documents: [], indexes: [] };
  }

  const collection = mongoose.connection.db.collection(COLLECTION_NAME);
  return {
    documents: await collection.find({}).sort({ _id: 1 }).toArray(),
    indexes: await collection.listIndexes().toArray(),
  };
};

const captureError = async (operation) => {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  throw new Error("Expected operation to reject");
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
  beforeEach(resetCollections);
  afterEach(async () => {
    jest.restoreAllMocks();
    await resetCollections();
  });

  it("is dry-run by default and performs no collection, index, or document write", async () => {
    const result = await migrateDatabase({ db: mongoose.connection.db });

    expect(result.mode).toBe("dry-run");
    expect(result.collectionExists).toBe(false);
    expect(result.indexes.unique.wouldCreate).toBe(true);
    expect(result.indexes.ttl.wouldCreate).toBe(true);
    expect(await collectionExists()).toBe(false);
  });

  it("reports abnormal processing rows and classifies non-expiring blockers read-only", async () => {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    const validExpiry = new Date("2099-01-01T00:00:00.000Z");
    const records = [
      rawProcessingRecord(),
      rawProcessingRecord({ expiresAt: null }),
      rawProcessingRecord({ expiresAt: "not-a-bson-date" }),
      rawProcessingRecord({ expiresAt: validExpiry }),
    ];
    await collection.insertMany(records);
    const before = await captureCollectionState();

    const result = await migrateDatabase({ db: mongoose.connection.db });

    expect(result).toMatchObject({
      mode: "dry-run",
      processingRecordCount: 4,
      nonExpiringProcessingCount: 3,
    });
    expect(result.processingRecordSample).toHaveLength(4);
    const diagnostics = new Map(
      result.processingRecordSample.map((record) => [record.recordId, record])
    );
    expect(diagnostics.get(records[0]._id.toString())).toMatchObject({
      state: "processing",
      expiresAtState: "absent",
      expiresAtType: "missing",
      expiresAtTtlUsable: false,
    });
    expect(diagnostics.get(records[1]._id.toString())).toMatchObject({
      expiresAtState: "null",
      expiresAtType: "null",
      expiresAtTtlUsable: false,
    });
    expect(diagnostics.get(records[2]._id.toString())).toMatchObject({
      expiresAtState: "non-expiring",
      expiresAtType: "string",
      expiresAtTtlUsable: false,
    });
    expect(diagnostics.get(records[3]._id.toString())).toMatchObject({
      expiresAtState: "ttl-usable",
      expiresAtType: "date",
      expiresAtTtlUsable: true,
    });
    expect(await captureCollectionState()).toEqual(before);
  });

  it("bounds processing diagnostics and excludes secret-bearing record fields", async () => {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    const secret = "test-processing-sensitive-value-must-not-print";
    const records = Array.from({ length: 55 }, () =>
      rawProcessingRecord({
        rawIdempotencyKey: secret,
        authorization: `Bearer ${secret}`,
        arbitraryMetadata: { secret },
      })
    );
    await collection.insertMany(records);

    const result = await migrateDatabase({ db: mongoose.connection.db });
    const serialized = JSON.stringify(result);

    expect(result.processingRecordCount).toBe(55);
    expect(result.nonExpiringProcessingCount).toBe(55);
    expect(result.processingRecordSample).toHaveLength(50);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("rawIdempotencyKey");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("arbitraryMetadata");
    expect(serialized).not.toContain(records[0].requestHash);
    expect(serialized).not.toContain(records[0].keyHash);
  });

  it.each([
    ["missing expiresAt", ABSENT_EXPIRES_AT],
    ["null expiresAt", null],
    ["non-Date expiresAt", "not-a-bson-date"],
  ])("blocks apply before index creation for processing with %s", async (_case, expiresAt) => {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    await collection.insertOne(rawProcessingRecord({ expiresAt }));
    const before = await captureCollectionState();
    const createIndex = jest.spyOn(
      mongoose.mongo.Collection.prototype,
      "createIndex"
    );

    const error = await captureError(() =>
      migrateDatabase({ db: mongoose.connection.db, apply: true })
    );

    expect(error).toMatchObject({
      message:
        "Non-expiring processing idempotency records block safe migration",
      migrationSummary: {
        mode: "apply",
        processingRecordCount: 1,
        nonExpiringProcessingCount: 1,
      },
    });
    expect(createIndex).not.toHaveBeenCalled();
    expect(await captureCollectionState()).toEqual(before);
  });

  it("reports a future BSON-Date processing row without classifying it as non-expiring", async () => {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    const record = rawProcessingRecord({
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    await collection.insertOne(record);

    const dryRun = await migrateDatabase({ db: mongoose.connection.db });
    expect(dryRun).toMatchObject({
      processingRecordCount: 1,
      nonExpiringProcessingCount: 0,
    });
    expect(dryRun.processingRecordSample[0]).toMatchObject({
      recordId: record._id.toString(),
      expiresAtState: "ttl-usable",
      expiresAtType: "date",
      expiresAtTtlUsable: true,
    });

    const applied = await migrateDatabase({
      db: mongoose.connection.db,
      apply: true,
    });
    expect(applied.indexes.unique.created).toBe(true);
    expect(applied.indexes.ttl.created).toBe(true);
    expect(await collection.findOne({ _id: record._id })).toBeDefined();
  });

  it("uses MongoDB TTL semantics for arrays that do or do not contain a BSON Date", async () => {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    const ttlUsable = rawProcessingRecord({
      expiresAt: ["legacy", new Date("2099-01-01T00:00:00.000Z")],
    });
    const nonExpiring = rawProcessingRecord({
      expiresAt: ["legacy", null],
    });
    await collection.insertMany([ttlUsable, nonExpiring]);

    const result = await migrateDatabase({ db: mongoose.connection.db });
    const diagnostics = new Map(
      result.processingRecordSample.map((record) => [record.recordId, record])
    );

    expect(result.processingRecordCount).toBe(2);
    expect(result.nonExpiringProcessingCount).toBe(1);
    expect(diagnostics.get(ttlUsable._id.toString())).toMatchObject({
      expiresAtType: "array",
      expiresAtTtlUsable: true,
    });
    expect(diagnostics.get(nonExpiring._id.toString())).toMatchObject({
      expiresAtType: "array",
      expiresAtTtlUsable: false,
    });
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

  it("refuses malformed and missing processing-repair targets", async () => {
    const before = await captureCollectionState();
    await expect(
      migrateDatabase({
        db: mongoose.connection.db,
        repairProcessingRecordId: "not-an-object-id",
      })
    ).rejects.toThrow("Invalid idempotency processing repair record ID");
    await expect(
      migrateDatabase({
        db: mongoose.connection.db,
        repairProcessingRecordId: new mongoose.Types.ObjectId().toString(),
      })
    ).rejects.toThrow("Idempotency processing repair target was not found");
    expect(await captureCollectionState()).toEqual(before);
  });

  it("refuses a completed record and a TTL-usable processing record", async () => {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    const completed = rawProcessingRecord({
      state: "completed",
      statusCode: 201,
      responseBody: { message: "completed" },
      responseSizeBytes: 23,
      completedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    const ttlUsable = rawProcessingRecord({
      expiresAt: [new Date("2099-01-01T00:00:00.000Z")],
    });
    await collection.insertMany([completed, ttlUsable]);
    const before = await captureCollectionState();

    await expect(
      migrateDatabase({
        db: mongoose.connection.db,
        repairProcessingRecordId: completed._id.toString(),
      })
    ).rejects.toThrow(
      "Idempotency processing repair target is not in processing state"
    );
    await expect(
      migrateDatabase({
        db: mongoose.connection.db,
        repairProcessingRecordId: ttlUsable._id.toString(),
      })
    ).rejects.toThrow(
      "Idempotency processing repair target can expire through TTL"
    );
    expect(await captureCollectionState()).toEqual(before);
  });

  it.each([
    ["statusCode", null],
    ["responseBody", null],
    ["responseSizeBytes", null],
    ["completedAt", null],
  ])(
    "refuses processing with completion-like %s evidence even when null",
    async (field, value) => {
      const collection = mongoose.connection.db.collection(COLLECTION_NAME);
      const record = rawProcessingRecord({ [field]: value });
      await collection.insertOne(record);
      const before = await captureCollectionState();

      await expect(
        migrateDatabase({
          db: mongoose.connection.db,
          repairProcessingRecordId: record._id.toString(),
        })
      ).rejects.toThrow(
        "Idempotency processing repair target has completion evidence"
      );
      expect(await captureCollectionState()).toEqual(before);
    }
  );

  it.each([
    ["AuditEvent", "auditevents"],
    ["OutboxEvent", "outboxevents"],
  ])("refuses processing linked to %s evidence", async (label, collectionName) => {
    const db = mongoose.connection.db;
    const target = rawProcessingRecord();
    await db.collection(COLLECTION_NAME).insertOne(target);
    await db.collection(collectionName).insertOne({
      idempotency: { recordId: target._id.toString() },
      marker: `${label}-must-remain`,
    });
    const targetBefore = await captureCollectionState();
    const evidenceBefore = await db
      .collection(collectionName)
      .find({})
      .toArray();

    await expect(
      migrateDatabase({
        db,
        repairProcessingRecordId: target._id.toString().toUpperCase(),
      })
    ).rejects.toThrow(
      `Idempotency processing repair target has linked ${label} evidence`
    );
    expect(await captureCollectionState()).toEqual(targetBefore);
    expect(await db.collection(collectionName).find({}).toArray()).toEqual(
      evidenceBefore
    );
  });

  it.each([
    ["missing expiry", ABSENT_EXPIRES_AT],
    ["null expiry", null],
    ["non-Date expiry", "not-a-bson-date"],
    ["array without a Date", ["legacy", null]],
  ])("repairs exactly one eligible processing record with %s", async (_label, expiresAt) => {
    const db = mongoose.connection.db;
    const collection = db.collection(COLLECTION_NAME);
    const target = rawProcessingRecord({ expiresAt });
    const unrelatedProcessing = rawProcessingRecord();
    const unrelatedCompleted = rawProcessingRecord({
      state: "completed",
      statusCode: 200,
      responseBody: { message: "unrelated" },
      responseSizeBytes: 23,
      completedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    await collection.insertMany([
      target,
      unrelatedProcessing,
      unrelatedCompleted,
    ]);
    await db.collection("auditevents").insertOne({
      idempotency: { recordId: unrelatedProcessing._id.toString() },
      marker: "unrelated-audit",
    });
    await db.collection("outboxevents").insertOne({
      idempotency: { recordId: unrelatedProcessing._id.toString() },
      marker: "unrelated-outbox",
    });
    const unrelatedDocumentsBefore = await collection
      .find({ _id: { $ne: target._id } })
      .sort({ _id: 1 })
      .toArray();
    const auditsBefore = await db.collection("auditevents").find({}).toArray();
    const outboxesBefore = await db.collection("outboxevents").find({}).toArray();

    const result = await migrateDatabase({
      db,
      repairProcessingRecordId: target._id.toString(),
    });

    expect(result).toEqual({
      mode: "repair-processing",
      database: db.databaseName,
      recordId: target._id.toString(),
      deletedCount: 1,
    });
    expect(await collection.findOne({ _id: target._id })).toBeNull();
    expect(
      await collection
        .find({ _id: { $ne: target._id } })
        .sort({ _id: 1 })
        .toArray()
    ).toEqual(unrelatedDocumentsBefore);
    expect(await db.collection("auditevents").find({}).toArray()).toEqual(
      auditsBefore
    );
    expect(await db.collection("outboxevents").find({}).toArray()).toEqual(
      outboxesBefore
    );
  });

  it("fails when conditional delete eligibility changes before deletion", async () => {
    const db = mongoose.connection.db;
    const collection = db.collection(COLLECTION_NAME);
    const target = rawProcessingRecord();
    await collection.insertOne(target);
    const originalDeleteOne = mongoose.mongo.Collection.prototype.deleteOne;
    const deleteOne = jest
      .spyOn(mongoose.mongo.Collection.prototype, "deleteOne")
      .mockImplementation(async function changeBeforeDelete(filter, options) {
        if (this.collectionName === COLLECTION_NAME) {
          await this.updateOne(
            { _id: target._id },
            { $set: { expiresAt: new Date("2099-01-01T00:00:00.000Z") } }
          );
        }
        return originalDeleteOne.call(this, filter, options);
      });

    await expect(
      migrateDatabase({
        db,
        repairProcessingRecordId: target._id.toString(),
      })
    ).rejects.toThrow(
      "Idempotency processing repair target changed; no record was deleted"
    );
    expect(deleteOne).toHaveBeenCalledTimes(1);
    expect(deleteOne.mock.calls[0][0]).toMatchObject({
      _id: target._id,
      state: "processing",
      expiresAt: { $not: { $type: "date" } },
      statusCode: { $exists: false },
      responseBody: { $exists: false },
      responseSizeBytes: { $exists: false },
      completedAt: { $exists: false },
    });
    await expect(collection.findOne({ _id: target._id })).resolves.toMatchObject({
      state: "processing",
      expiresAt: expect.any(Date),
    });
  });

  it("recovers through one repair, dry-run, apply, and idempotent second apply", async () => {
    const db = mongoose.connection.db;
    const collection = db.collection(COLLECTION_NAME);
    const target = rawProcessingRecord();
    await collection.insertOne(target);
    const beforeBlockedApply = await captureCollectionState();

    const blockedDryRun = await migrateDatabase({ db });
    expect(blockedDryRun.nonExpiringProcessingCount).toBe(1);
    await expect(migrateDatabase({ db, apply: true })).rejects.toThrow(
      "Non-expiring processing idempotency records block safe migration"
    );
    expect(await captureCollectionState()).toEqual(beforeBlockedApply);

    await migrateDatabase({
      db,
      repairProcessingRecordId: target._id.toString(),
    });
    const repairedDryRun = await migrateDatabase({ db });
    expect(repairedDryRun).toMatchObject({
      processingRecordCount: 0,
      nonExpiringProcessingCount: 0,
    });

    const firstApply = await migrateDatabase({ db, apply: true });
    expect(firstApply.indexes.unique.created).toBe(true);
    expect(firstApply.indexes.ttl.created).toBe(true);
    const afterFirstApply = await captureCollectionState();
    const secondApply = await migrateDatabase({ db, apply: true });
    expect(secondApply.indexes.unique.created).toBe(false);
    expect(secondApply.indexes.ttl.created).toBe(false);
    expect(await captureCollectionState()).toEqual(afterFirstApply);
  });

  it("accepts only dry-run, apply, or one exact processing repair target", async () => {
    const recordId = new mongoose.Types.ObjectId().toString();
    const accepted = [
      [[], { mode: "dry-run", apply: false }, { apply: false }],
      [["--apply"], { mode: "apply", apply: true }, { apply: true }],
      [
        ["--repair-processing", recordId.toUpperCase()],
        {
          mode: "repair-processing",
          apply: false,
          repairProcessingRecordId: recordId,
        },
        { repairProcessingRecordId: recordId },
      ],
    ];

    for (const [args, parsed, forwarded] of accepted) {
      expect(parseMigrationArgs(args)).toEqual(parsed);
      const executeMigration = jest.fn().mockResolvedValue(undefined);
      const logger = { log: jest.fn(), error: jest.fn() };

      await expect(
        runMigrationCli({ args, executeMigration, logger })
      ).resolves.toBe(0);
      expect(executeMigration).toHaveBeenCalledWith({ ...forwarded, logger });
    }

    for (const args of [
      ["--unknown"],
      ["--apply", "--unknown"],
      ["--apply", "--apply"],
      ["--repair-processing"],
      ["--repair-processing", recordId, "extra"],
      ["--apply", "--repair-processing", recordId],
      ["--repair-processing", recordId, "--apply"],
      ["--repair-processing", "*"],
      ["--repair-processing", "all"],
      ["--repair-processing", "invalid-id"],
      ["--repair-processing", "f".repeat(23)],
      ["--repair-processing", "g".repeat(24)],
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
      CLI_USAGE
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
