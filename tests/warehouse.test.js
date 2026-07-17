const request = require("supertest");

const app = require("../src/app");
const Warehouse = require("../src/models/Warehouse");
const {
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

describe("Warehouse API", () => {
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
        { id: warehouses[0]._id.toString(), name: "Updated One" },
        { id: warehouses[1]._id.toString(), status: "inactive" },
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
      .send({ code: "WH-CHANGED" });

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
      .send([{ id: warehouse._id.toString(), name: "   " }]);

    expect(response.statusCode).toBe(400);
    expect((await Warehouse.findById(warehouse._id)).name).toBe(
      "Original Bulk Name"
    );
  });
});
