const request = require("supertest");

const app = require("../src/app");

require("./setupTestDb");

describe("Warehouse API", () => {
  it("should retrieve all warehouses", async () => {
    const response = await request(app).get("/api/warehouses");

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Warehouses retrieved successfully");
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("should create a new warehouse", async () => {
    const response = await request(app)
      .post("/api/warehouses")
      .send({
        code: "WH-TEST-001",
        name: "Test Warehouse",
        description: "Warehouse created during automated test",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("Warehouse created successfully");
    expect(response.body.data).toHaveProperty("_id");
    expect(response.body.data.code).toBe("WH-TEST-001");
    expect(response.body.data.name).toBe("Test Warehouse");
    expect(response.body.data.status).toBe("active");
  });

  it("should store warehouse code in uppercase", async () => {
    const response = await request(app)
      .post("/api/warehouses")
      .send({
        code: "wh-lowercase-001",
        name: "Lowercase Warehouse",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.data.code).toBe("WH-LOWERCASE-001");
  });

  it("should reject duplicate warehouse code", async () => {
    await request(app)
      .post("/api/warehouses")
      .send({
        code: "WH-DUPLICATE-001",
        name: "First Warehouse",
      });

    const response = await request(app)
      .post("/api/warehouses")
      .send({
        code: "WH-DUPLICATE-001",
        name: "Second Warehouse",
      });

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toBe("A warehouse with this code already exists");
  });

  it("should reject warehouse creation without required fields", async () => {
    const response = await request(app)
      .post("/api/warehouses")
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe("Validation failed");
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "code",
          message: "Warehouse code is required",
        }),
        expect.objectContaining({
          field: "name",
          message: "Warehouse name is required",
        }),
      ])
    );
  });
});