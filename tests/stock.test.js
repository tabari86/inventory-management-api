const request = require("supertest");

const app = require("../src/app");

require("./setupTestDb");

const createTestProduct = async () => {
  const response = await request(app)
    .post("/api/products")
    .send({
      sku: "STOCK-PRODUCT-001",
      name: "Stock Test Product",
      unit: "piece",
    });

  return response.body.data;
};

const createTestWarehouse = async () => {
  const response = await request(app)
    .post("/api/warehouses")
    .send({
      code: "WH-STOCK-001",
      name: "Stock Test Warehouse",
    });

  return response.body.data;
};

describe("Stock API", () => {
  it("should retrieve all stock records", async () => {
    const response = await request(app).get("/api/stocks");

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Stock records retrieved successfully");
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("should create a stock record for product and warehouse", async () => {
    const product = await createTestProduct();
    const warehouse = await createTestWarehouse();

    const response = await request(app)
      .post("/api/stocks")
      .send({
        productId: product._id,
        warehouseId: warehouse._id,
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("Stock record created successfully");
    expect(response.body.data).toHaveProperty("_id");
    expect(response.body.data.productId).toBe(product._id);
    expect(response.body.data.warehouseId).toBe(warehouse._id);
    expect(response.body.data.quantity).toBe(0);
    expect(response.body.data.status).toBe("active");
  });

  it("should reject duplicate stock record for same product and warehouse", async () => {
    const product = await createTestProduct();
    const warehouse = await createTestWarehouse();

    await request(app)
      .post("/api/stocks")
      .send({
        productId: product._id,
        warehouseId: warehouse._id,
      });

    const response = await request(app)
      .post("/api/stocks")
      .send({
        productId: product._id,
        warehouseId: warehouse._id,
      });

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toBe(
      "Stock record already exists for this product and warehouse"
    );
  });

  it("should reject stock creation with missing required fields", async () => {
    const response = await request(app)
      .post("/api/stocks")
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe("Validation failed");
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "productId",
          message: "Product ID is required",
        }),
        expect.objectContaining({
          field: "warehouseId",
          message: "Warehouse ID is required",
        }),
      ])
    );
  });
});