const request = require("supertest");

const app = require("../src/app");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const {
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const createTestStock = async () => {
  const [product, warehouse] = await Promise.all([
    Product.create({
      sku: "MOVEMENT-PRODUCT-001",
      name: "Movement Test Product",
    }),
    Warehouse.create({
      code: "WH-MOVEMENT-001",
      name: "Movement Test Warehouse",
    }),
  ]);

  return Stock.create({
    productId: product._id,
    warehouseId: warehouse._id,
  });
};

const createTestMovement = async () => {
  const stock = await createTestStock();

  return StockMovement.create({
    stockId: stock._id,
    type: "GOODS_RECEIPT",
    quantity: 5,
    reference: "PO-MOVEMENT-001",
  });
};

describe("Stock Movement API", () => {
  it("rejects unauthenticated stock movement retrieval", async () => {
    const response = await request(app).get("/api/stock-movements");

    expect(response.statusCode).toBe(401);
  });

  it("allows a viewer to retrieve stock movements", async () => {
    const viewerToken = await createViewerToken();

    const response = await request(app)
      .get("/api/stock-movements")
      .set("Authorization", `Bearer ${viewerToken}`);

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("allows a manager to retrieve stock movements", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .get("/api/stock-movements")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("rejects unauthenticated retrieval of a stock movement by ID", async () => {
    const movement = await createTestMovement();

    const response = await request(app).get(
      `/api/stock-movements/${movement._id}`
    );

    expect(response.statusCode).toBe(401);
  });

  it("allows a viewer to retrieve an existing stock movement by ID", async () => {
    const viewerToken = await createViewerToken();
    const movement = await createTestMovement();

    const response = await request(app)
      .get(`/api/stock-movements/${movement._id}`)
      .set("Authorization", `Bearer ${viewerToken}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.data._id).toBe(movement._id.toString());
  });

  it("does not expose manual stock movement creation", async () => {
    const managerToken = await createManagerToken();
    const stock = await createTestStock();

    const response = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        stockId: stock._id.toString(),
        type: "GOODS_RECEIPT",
        quantity: 3,
      });

    expect(response.statusCode).toBe(404);
    expect(await StockMovement.countDocuments()).toBe(0);
  });
});
