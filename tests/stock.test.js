const request = require("supertest");

const app = require("../src/app");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const Warehouse = require("../src/models/Warehouse");
const {
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const createProductAndWarehouse = async (overrides = {}) => {
  const [product, warehouse] = await Promise.all([
    Product.create({
      sku: overrides.sku || "STOCK-PRODUCT-001",
      name: "Stock Test Product",
      status: overrides.productStatus || "active",
    }),
    Warehouse.create({
      code: overrides.code || "WH-STOCK-001",
      name: "Stock Test Warehouse",
      status: overrides.warehouseStatus || "active",
    }),
  ]);

  return { product, warehouse };
};

describe("Stock API", () => {
  it("allows authenticated viewers to retrieve stock records", async () => {
    const viewerToken = await createViewerToken();
    const response = await request(app)
      .get("/api/stocks")
      .set("Authorization", `Bearer ${viewerToken}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Stock records retrieved successfully");
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("rejects unauthenticated stock creation", async () => {
    const { product, warehouse } = await createProductAndWarehouse();
    const response = await request(app)
      .post("/api/stocks")
      .send({ productId: product._id, warehouseId: warehouse._id });

    expect(response.statusCode).toBe(401);
  });

  it("rejects stock creation by a viewer", async () => {
    const viewerToken = await createViewerToken();
    const { product, warehouse } = await createProductAndWarehouse();
    const response = await request(app)
      .post("/api/stocks")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ productId: product._id, warehouseId: warehouse._id });

    expect(response.statusCode).toBe(403);
  });

  it("allows a manager to create stock at quantity zero", async () => {
    const managerToken = await createManagerToken();
    const { product, warehouse } = await createProductAndWarehouse();
    const response = await request(app)
      .post("/api/stocks")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ productId: product._id, warehouseId: warehouse._id });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("Stock record created successfully");
    expect(response.body.data.quantity).toBe(0);
  });

  it("bulk creates stock records for a manager", async () => {
    const managerToken = await createManagerToken();
    const products = await Product.create([
      { sku: "BULK-STOCK-001", name: "Bulk Stock One" },
      { sku: "BULK-STOCK-002", name: "Bulk Stock Two" },
    ]);
    const warehouse = await Warehouse.create({
      code: "WH-BULK-STOCK",
      name: "Bulk Stock Warehouse",
    });

    const response = await request(app)
      .post("/api/stocks/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send(
        products.map((product) => ({
          productId: product._id.toString(),
          warehouseId: warehouse._id.toString(),
        }))
      );

    expect(response.statusCode).toBe(201);
    expect(response.body.data.createdCount).toBe(2);
    expect(response.body.data.stocks.every((stock) => stock.quantity === 0)).toBe(
      true
    );
  });

  it("rejects duplicate combinations inside bulk create", async () => {
    const managerToken = await createManagerToken();
    const { product, warehouse } = await createProductAndWarehouse();
    const stockRecord = {
      productId: product._id.toString(),
      warehouseId: warehouse._id.toString(),
    };

    const response = await request(app)
      .post("/api/stocks/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([stockRecord, stockRecord]);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      message: "Duplicate product and warehouse combinations are not allowed",
    });
    expect(await Stock.countDocuments()).toBe(0);
  });

  it("uses the corrected v1 code for duplicate combinations in one bulk command", async () => {
    const managerToken = await createManagerToken();
    const { product, warehouse } = await createProductAndWarehouse();
    const stockRecord = {
      productId: product._id.toString(),
      warehouseId: warehouse._id.toString(),
    };

    const response = await request(app)
      .post("/api/v1/stocks/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([stockRecord, stockRecord]);

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      title: "Validation failed",
      code: "VALIDATION_FAILED",
      detail: "Duplicate product and warehouse combinations are not allowed",
    });
  });

  it("rejects existing combinations in bulk create", async () => {
    const managerToken = await createManagerToken();
    const { product, warehouse } = await createProductAndWarehouse();
    await Stock.create({ productId: product._id, warehouseId: warehouse._id });

    const response = await request(app)
      .post("/api/stocks/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          productId: product._id.toString(),
          warehouseId: warehouse._id.toString(),
        },
      ]);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      message: "One or more stock records already exist",
    });
  });

  it("preserves DUPLICATE_RESOURCE for a persisted Stock collision in v1", async () => {
    const managerToken = await createManagerToken();
    const { product, warehouse } = await createProductAndWarehouse();
    await Stock.create({ productId: product._id, warehouseId: warehouse._id });

    const response = await request(app)
      .post("/api/v1/stocks/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          productId: product._id.toString(),
          warehouseId: warehouse._id.toString(),
        },
      ]);

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      title: "Duplicate resource",
      code: "DUPLICATE_RESOURCE",
      detail: "One or more stock records already exist",
    });
  });

  it("rejects inactive products in bulk create", async () => {
    const managerToken = await createManagerToken();
    const { product, warehouse } = await createProductAndWarehouse({
      productStatus: "inactive",
    });

    const response = await request(app)
      .post("/api/stocks/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          productId: product._id.toString(),
          warehouseId: warehouse._id.toString(),
        },
      ]);

    expect(response.statusCode).toBe(409);
    expect(await Stock.countDocuments()).toBe(0);
  });

  it("rejects inactive warehouses in bulk create", async () => {
    const managerToken = await createManagerToken();
    const { product, warehouse } = await createProductAndWarehouse({
      warehouseStatus: "inactive",
    });

    const response = await request(app)
      .post("/api/stocks/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          productId: product._id.toString(),
          warehouseId: warehouse._id.toString(),
        },
      ]);

    expect(response.statusCode).toBe(409);
    expect(await Stock.countDocuments()).toBe(0);
  });
});
