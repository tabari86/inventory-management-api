const request = require("supertest");

const app = require("../src/app");
const AuditEvent = require("../src/models/AuditEvent");
const IdempotencyRecord = require("../src/models/IdempotencyRecord");
const OutboxEvent = require("../src/models/OutboxEvent");
const Warehouse = require("../src/models/Warehouse");
const warehouseService = require("../src/services/warehouseService");
const {
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const WAREHOUSE_NAME_TYPE_MESSAGE = "Warehouse name must be a string";
const MALFORMED_WAREHOUSE_NAME_CASES = [
  {
    caseName: "object",
    caseKey: "object",
    createValue: (marker) => ({ probe: marker }),
    hasMarker: true,
  },
  {
    caseName: "array",
    caseKey: "array",
    createValue: (marker) => [marker],
    hasMarker: true,
  },
  {
    caseName: "number",
    caseKey: "number",
    createValue: () => 804,
    hasMarker: false,
  },
  {
    caseName: "boolean",
    caseKey: "boolean",
    createValue: () => true,
    hasMarker: false,
  },
  {
    caseName: "null",
    caseKey: "null",
    createValue: () => null,
    hasMarker: false,
  },
];

describe("Warehouse API", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows authenticated viewers to retrieve warehouses", async () => {
    const viewerToken = await createViewerToken();
    const response = await request(app)
      .get("/api/warehouses")
      .set("Authorization", `Bearer ${viewerToken}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Warehouses retrieved successfully");
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("rejects unauthenticated warehouse creation", async () => {
    const response = await request(app)
      .post("/api/warehouses")
      .send({ code: "WH-UNAUTH", name: "Unauthorized Warehouse" });

    expect(response.statusCode).toBe(401);
  });

  it("rejects warehouse creation by a viewer", async () => {
    const viewerToken = await createViewerToken();
    const response = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ code: "WH-VIEWER", name: "Viewer Warehouse" });

    expect(response.statusCode).toBe(403);
  });

  it("allows a manager to create a warehouse and uppercases its code", async () => {
    const managerToken = await createManagerToken();
    const response = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        code: "wh-test-001",
        name: "Test Warehouse",
        description: "Warehouse created during automated test",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("Warehouse created successfully");
    expect(response.body.data.code).toBe("WH-TEST-001");
    expect(response.body.data.status).toBe("active");
  });

  it("bulk creates warehouses for a manager", async () => {
    const managerToken = await createManagerToken();
    const response = await request(app)
      .post("/api/warehouses/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { code: "wh-bulk-001", name: "Bulk Warehouse One" },
        { code: "WH-BULK-002", name: "Bulk Warehouse Two" },
      ]);

    expect(response.statusCode).toBe(201);
    expect(response.body.data.createdCount).toBe(2);
    expect(response.body.data.warehouses[0].code).toBe("WH-BULK-001");
  });

  it("rejects duplicate codes inside bulk create without partial data", async () => {
    const managerToken = await createManagerToken();
    const response = await request(app)
      .post("/api/warehouses/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { code: "wh-duplicate", name: "First Warehouse" },
        { code: "WH-DUPLICATE", name: "Second Warehouse" },
      ]);

    expect(response.statusCode).toBe(400);
    expect(await Warehouse.countDocuments()).toBe(0);
  });

  it("rejects an existing code in bulk create", async () => {
    const managerToken = await createManagerToken();
    await Warehouse.create({ code: "WH-EXISTING", name: "Existing Warehouse" });

    const response = await request(app)
      .post("/api/warehouses/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { code: "WH-NEW", name: "New Warehouse" },
        { code: "wh-existing", name: "Duplicate Warehouse" },
      ]);

    expect(response.statusCode).toBe(409);
    expect(await Warehouse.findOne({ code: "WH-NEW" })).toBeNull();
  });

  it("bulk updates warehouses for a manager", async () => {
    const managerToken = await createManagerToken();
    const warehouses = await Warehouse.create([
      { code: "WH-UPDATE-001", name: "Original One" },
      { code: "WH-UPDATE-002", name: "Original Two" },
    ]);

    const response = await request(app)
      .patch("/api/warehouses/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: warehouses[0]._id.toString(),
          name: "Updated One",
          expectedVersion: warehouses[0].version,
        },
        {
          id: warehouses[1]._id.toString(),
          status: "inactive",
          expectedVersion: warehouses[1].version,
        },
      ]);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.updatedCount).toBe(2);
    expect((await Warehouse.findById(warehouses[0]._id)).name).toBe("Updated One");
    expect((await Warehouse.findById(warehouses[1]._id)).status).toBe("inactive");
  });

  it("does not allow warehouse codes to be changed in bulk update", async () => {
    const managerToken = await createManagerToken();
    const warehouse = await Warehouse.create({
      code: "WH-IMMUTABLE",
      name: "Immutable Code Warehouse",
    });

    const response = await request(app)
      .patch("/api/warehouses/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: warehouse._id.toString(),
          code: "WH-CHANGED",
          name: "Changed Name",
          expectedVersion: warehouse.version,
        },
      ]);

    expect(response.statusCode).toBe(400);
    expect((await Warehouse.findById(warehouse._id)).code).toBe("WH-IMMUTABLE");
  });

  it("rejects an empty single-warehouse update", async () => {
    const managerToken = await createManagerToken();
    const warehouse = await Warehouse.create({
      code: "WH-EMPTY-UPDATE",
      name: "Empty Update Warehouse",
    });

    const response = await request(app)
      .patch(`/api/warehouses/${warehouse._id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe("Validation failed");
  });

  it("rejects code changes in a single-warehouse update", async () => {
    const managerToken = await createManagerToken();
    const warehouse = await Warehouse.create({
      code: "WH-ORIGINAL",
      name: "Original Code Warehouse",
    });

    const response = await request(app)
      .patch(`/api/warehouses/${warehouse._id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ code: "WH-CHANGED", expectedVersion: warehouse.version });

    expect(response.statusCode).toBe(400);
    expect((await Warehouse.findById(warehouse._id)).code).toBe("WH-ORIGINAL");
  });

  it("rejects a whitespace-only code when creating a warehouse", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ code: "   ", name: "Valid Warehouse" });

    expect(response.statusCode).toBe(400);
    expect(await Warehouse.countDocuments()).toBe(0);
  });

  it("rejects a whitespace-only name when creating a warehouse", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ code: "WH-VALID-001", name: "   " });

    expect(response.statusCode).toBe(400);
    expect(await Warehouse.countDocuments()).toBe(0);
  });

  it("rejects whitespace-only required values in bulk warehouse creation", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/warehouses/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { code: "WH-BULK-VALID", name: "Valid Bulk Warehouse" },
        { code: "WH-BULK-INVALID", name: "   " },
      ]);

    expect(response.statusCode).toBe(400);
    expect(await Warehouse.countDocuments()).toBe(0);
  });

  it("rejects a whitespace-only name in bulk warehouse update", async () => {
    const managerToken = await createManagerToken();
    const warehouse = await Warehouse.create({
      code: "WH-BULK-NAME",
      name: "Original Bulk Name",
    });

    const response = await request(app)
      .patch("/api/warehouses/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: warehouse._id.toString(),
          name: "   ",
          expectedVersion: warehouse.version,
        },
      ]);

    expect(response.statusCode).toBe(400);
    expect((await Warehouse.findById(warehouse._id)).name).toBe(
      "Original Bulk Name"
    );
  });

  it("rejects a non-string warehouse description", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        code: "WH-DESCRIPTION-001",
        name: "Description Validation Warehouse",
        description: ["invalid"],
      });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a warehouse code containing unsupported characters", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ code: "INVALID CODE!", name: "Invalid Code Warehouse" });

    expect(response.statusCode).toBe(400);
    expect(await Warehouse.countDocuments()).toBe(0);
  });

  it("rejects a warehouse code longer than 64 characters", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ code: "W".repeat(65), name: "Long Code Warehouse" });

    expect(response.statusCode).toBe(400);
    expect(await Warehouse.countDocuments()).toBe(0);
  });

  describe("name input structure", () => {
    it.each(MALFORMED_WAREHOUSE_NAME_CASES)(
      "rejects a canonical create $caseName name before business execution",
      async ({ caseKey, createValue, hasMarker }) => {
        const managerToken = await createManagerToken();
        const marker = `v804-warehouse-create-${caseKey}-submitted-marker`;
        const createWarehouseSpy = jest.spyOn(
          warehouseService,
          "createWarehouse"
        );

        const response = await request(app)
          .post("/api/v1/warehouses")
          .set("Authorization", `Bearer ${managerToken}`)
          .set(
            "Idempotency-Key",
            `v804.warehouse.create.${caseKey}.0001`
          )
          .send({
            code: `V804-CREATE-${caseKey}`,
            name: createValue(marker),
          });

        expect(response.statusCode).toBe(400);
        expect(response.body).toMatchObject({
          type: "inventory-error",
          status: 400,
          code: "VALIDATION_FAILED",
          errors: [
            { field: "name", message: WAREHOUSE_NAME_TYPE_MESSAGE },
          ],
        });
        expect(createWarehouseSpy).not.toHaveBeenCalled();
        expect(await Warehouse.countDocuments()).toBe(0);
        expect(await AuditEvent.countDocuments()).toBe(0);
        expect(await OutboxEvent.countDocuments()).toBe(0);
        expect(await IdempotencyRecord.countDocuments()).toBe(0);
        if (hasMarker) {
          expect(JSON.stringify(response.body)).not.toContain(marker);
        }
      }
    );

    it("accepts and trims a canonical surrounding-whitespace create name", async () => {
      const managerToken = await createManagerToken();

      const response = await request(app)
        .post("/api/v1/warehouses")
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", "v804.warehouse.create.valid.0001")
        .send({
          code: "V804-CREATE-VALID",
          name: "  V804 Trimmed Warehouse  ",
        });

      expect(response.statusCode).toBe(201);
      expect(response.body.data).toMatchObject({
        code: "V804-CREATE-VALID",
        name: "V804 Trimmed Warehouse",
        version: 1,
      });
      expect(
        await Warehouse.findOne({ code: "V804-CREATE-VALID" }).lean()
      ).toMatchObject({ name: "V804 Trimmed Warehouse", version: 1 });
    });

    it.each(MALFORMED_WAREHOUSE_NAME_CASES)(
      "rejects a canonical update $caseName name before business execution",
      async ({ caseKey, createValue, hasMarker }) => {
        const managerToken = await createManagerToken();
        const warehouse = await Warehouse.create({
          code: `V804-UPDATE-${caseKey}`,
          name: "V804 Original Warehouse",
        });
        const before = await Warehouse.findById(warehouse._id).lean();
        const marker = `v804-warehouse-update-${caseKey}-submitted-marker`;
        const updateWarehouseSpy = jest.spyOn(
          warehouseService,
          "updateWarehouse"
        );

        const response = await request(app)
          .patch(`/api/v1/warehouses/${warehouse._id}`)
          .set("Authorization", `Bearer ${managerToken}`)
          .set(
            "Idempotency-Key",
            `v804.warehouse.update.${caseKey}.0001`
          )
          .send({
            name: createValue(marker),
            expectedVersion: warehouse.version,
          });

        expect(response.statusCode).toBe(400);
        expect(response.body).toMatchObject({
          type: "inventory-error",
          status: 400,
          code: "VALIDATION_FAILED",
          errors: [
            { field: "name", message: WAREHOUSE_NAME_TYPE_MESSAGE },
          ],
        });
        expect(updateWarehouseSpy).not.toHaveBeenCalled();
        expect(await Warehouse.findById(warehouse._id).lean()).toEqual(before);
        expect(await AuditEvent.countDocuments()).toBe(0);
        expect(await OutboxEvent.countDocuments()).toBe(0);
        expect(await IdempotencyRecord.countDocuments()).toBe(0);
        if (hasMarker) {
          expect(JSON.stringify(response.body)).not.toContain(marker);
        }
      }
    );

    it("accepts and trims a canonical update name with one version increment", async () => {
      const managerToken = await createManagerToken();
      const warehouse = await Warehouse.create({
        code: "V804-UPDATE-VALID",
        name: "V804 Original Warehouse",
      });

      const response = await request(app)
        .patch(`/api/v1/warehouses/${warehouse._id}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", "v804.warehouse.update.valid.0001")
        .send({
          name: "  V804 Updated Warehouse  ",
          expectedVersion: warehouse.version,
        });

      expect(response.statusCode).toBe(200);
      expect(response.body.data).toMatchObject({
        name: "V804 Updated Warehouse",
        version: warehouse.version + 1,
      });
      expect(await Warehouse.findById(warehouse._id).lean()).toMatchObject({
        name: "V804 Updated Warehouse",
        version: warehouse.version + 1,
      });
      expect(await AuditEvent.countDocuments()).toBe(1);
      expect(await OutboxEvent.countDocuments()).toBe(1);
      expect(await IdempotencyRecord.countDocuments()).toBe(1);
    });

    it("rejects object and number names in canonical bulk create before business execution", async () => {
      const managerToken = await createManagerToken();
      const marker = "v804-warehouse-bulk-create-submitted-marker";
      const createWarehousesBulkSpy = jest.spyOn(
        warehouseService,
        "createWarehousesBulk"
      );

      const response = await request(app)
        .post("/api/v1/warehouses/bulk")
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", "v804.warehouse.bulk-create.invalid.0001")
        .send([
          { code: "V804-BULK-CREATE-OBJECT", name: { probe: marker } },
          { code: "V804-BULK-CREATE-NUMBER", name: 804 },
        ]);

      expect(response.statusCode).toBe(400);
      expect(response.body).toMatchObject({
        type: "inventory-error",
        status: 400,
        code: "VALIDATION_FAILED",
      });
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          { field: "[0].name", message: WAREHOUSE_NAME_TYPE_MESSAGE },
          { field: "[1].name", message: WAREHOUSE_NAME_TYPE_MESSAGE },
        ])
      );
      expect(createWarehousesBulkSpy).not.toHaveBeenCalled();
      expect(await Warehouse.countDocuments()).toBe(0);
      expect(await AuditEvent.countDocuments()).toBe(0);
      expect(await OutboxEvent.countDocuments()).toBe(0);
      expect(await IdempotencyRecord.countDocuments()).toBe(0);
      expect(JSON.stringify(response.body)).not.toContain(marker);
    });

    it("rejects object and boolean names in canonical bulk update before business execution", async () => {
      const managerToken = await createManagerToken();
      const warehouses = await Warehouse.create([
        { code: "V804-BULK-UPDATE-OBJECT", name: "Original Object Target" },
        { code: "V804-BULK-UPDATE-BOOLEAN", name: "Original Boolean Target" },
      ]);
      const before = await Warehouse.find({}).sort({ _id: 1 }).lean();
      const marker = "v804-warehouse-bulk-update-submitted-marker";
      const updateWarehousesBulkSpy = jest.spyOn(
        warehouseService,
        "updateWarehousesBulk"
      );

      const response = await request(app)
        .patch("/api/v1/warehouses/bulk")
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", "v804.warehouse.bulk-update.invalid.0001")
        .send([
          {
            id: warehouses[0]._id.toString(),
            name: { probe: marker },
            expectedVersion: warehouses[0].version,
          },
          {
            id: warehouses[1]._id.toString(),
            name: true,
            expectedVersion: warehouses[1].version,
          },
        ]);

      expect(response.statusCode).toBe(400);
      expect(response.body).toMatchObject({
        type: "inventory-error",
        status: 400,
        code: "VALIDATION_FAILED",
      });
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          { field: "[0].name", message: WAREHOUSE_NAME_TYPE_MESSAGE },
          { field: "[1].name", message: WAREHOUSE_NAME_TYPE_MESSAGE },
        ])
      );
      expect(updateWarehousesBulkSpy).not.toHaveBeenCalled();
      expect(await Warehouse.find({}).sort({ _id: 1 }).lean()).toEqual(before);
      expect(await AuditEvent.countDocuments()).toBe(0);
      expect(await OutboxEvent.countDocuments()).toBe(0);
      expect(await IdempotencyRecord.countDocuments()).toBe(0);
      expect(JSON.stringify(response.body)).not.toContain(marker);
    });

    it("rejects a legacy object name before business execution", async () => {
      const managerToken = await createManagerToken();
      const marker = "v804-warehouse-legacy-submitted-marker";
      const createWarehouseSpy = jest.spyOn(
        warehouseService,
        "createWarehouse"
      );

      const response = await request(app)
        .post("/api/warehouses")
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", "v804.warehouse.legacy.invalid.0001")
        .send({
          code: "V804-LEGACY-OBJECT",
          name: { probe: marker },
        });

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({
        message: "Validation failed",
        errors: [{ field: "name", message: WAREHOUSE_NAME_TYPE_MESSAGE }],
      });
      expect(createWarehouseSpy).not.toHaveBeenCalled();
      expect(await Warehouse.countDocuments()).toBe(0);
      expect(await AuditEvent.countDocuments()).toBe(0);
      expect(await OutboxEvent.countDocuments()).toBe(0);
      expect(await IdempotencyRecord.countDocuments()).toBe(0);
      expect(JSON.stringify(response.body)).not.toContain(marker);
    });
  });
});
