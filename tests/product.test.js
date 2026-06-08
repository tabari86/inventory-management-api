const request = require("supertest");

const app = require("../src/app");

require("./setupTestDb");

describe("Product API", () => {
  it("should retrieve all products", async () => {
    const response = await request(app).get("/api/products");

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Products retrieved successfully");
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("should create a new product", async () => {
    const response = await request(app)
      .post("/api/products")
      .send({
        sku: "TEST-PRODUCT-001",
        name: "Test Product",
        description: "Product created during automated test",
        unit: "piece",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("Product created successfully");
    expect(response.body.data).toHaveProperty("_id");
    expect(response.body.data.sku).toBe("TEST-PRODUCT-001");
    expect(response.body.data.name).toBe("Test Product");
    expect(response.body.data.unit).toBe("piece");
    expect(response.body.data.status).toBe("active");
  });

  it("should reject duplicate SKU", async () => {
    await request(app)
      .post("/api/products")
      .send({
        sku: "DUPLICATE-SKU-001",
        name: "First Product",
        unit: "piece",
      });

    const response = await request(app)
      .post("/api/products")
      .send({
        sku: "DUPLICATE-SKU-001",
        name: "Second Product",
        unit: "piece",
      });

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toBe("A product with this SKU already exists");
  });

  it("should reject product creation without required fields", async () => {
    const response = await request(app)
      .post("/api/products")
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe("Validation failed");
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "sku",
          message: "SKU is required",
        }),
        expect.objectContaining({
          field: "name",
          message: "Product name is required",
        }),
      ])
    );
  });
});