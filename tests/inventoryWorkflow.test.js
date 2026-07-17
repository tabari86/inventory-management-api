const request = require("supertest");

const app = require("../src/app");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const {
  createAdminToken,
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const registerAndLoginAdmin = () => createAdminToken();

const createProduct = () =>
  Product.create({
    sku: "WORKFLOW-PRODUCT-001",
    name: "Workflow Product",
    unit: "piece",
  });

const createWarehouse = () =>
  Warehouse.create({
    code: "WH-WORKFLOW-001",
    name: "Workflow Warehouse",
  });

const createStock = (productId, warehouseId, quantity = 0) =>
  Stock.create({ productId, warehouseId, quantity });

describe("Inventory Workflow API", () => {
  it("should receive goods and increase stock quantity", async () => {
    const accessToken = await registerAndLoginAdmin();

    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id);

    const response = await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        stockId: stock._id,
        quantity: 10,
        reference: "PO-TEST-001",
        reason: "Automated goods receipt test",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("Goods receipt completed successfully");

    expect(response.body.data.stock._id).toBe(stock._id.toString());
    expect(response.body.data.stock.quantity).toBe(10);

    expect(response.body.data.stockMovement.stockId).toBe(stock._id.toString());
    expect(response.body.data.stockMovement.type).toBe("GOODS_RECEIPT");
    expect(response.body.data.stockMovement.quantity).toBe(10);
    expect(response.body.data.stockMovement.reference).toBe("PO-TEST-001");
  });

  it("should reject goods receipt without access token", async () => {
    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id);

    const response = await request(app)
      .post("/api/goods-receipts")
      .send({
        stockId: stock._id,
        quantity: 5,
        reference: "PO-NO-TOKEN-001",
        reason: "Missing token test",
      });

    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Access token is required");
  });

  it("should reject goods receipt for viewer role", async () => {
    const viewerAccessToken = await createViewerToken();

    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id);

    const response = await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${viewerAccessToken}`)
      .send({
        stockId: stock._id,
        quantity: 5,
        reference: "PO-VIEWER-001",
        reason: "Viewer role test",
      });

    expect(response.statusCode).toBe(403);
    expect(response.body.message).toBe("Access denied");
  });
  it("should issue goods and decrease stock quantity", async () => {
    const accessToken = await registerAndLoginAdmin();

    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id);

    await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        stockId: stock._id,
        quantity: 10,
        reference: "PO-BEFORE-ISSUE-001",
        reason: "Prepare stock for goods issue test",
      });

    const response = await request(app)
      .post("/api/goods-issues")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        stockId: stock._id,
        quantity: 4,
        reference: "SO-TEST-001",
        reason: "Automated goods issue test",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("Goods issue completed successfully");

    expect(response.body.data.stock._id).toBe(stock._id.toString());
    expect(response.body.data.stock.quantity).toBe(6);

    expect(response.body.data.stockMovement.stockId).toBe(stock._id.toString());
    expect(response.body.data.stockMovement.type).toBe("GOODS_ISSUE");
    expect(response.body.data.stockMovement.quantity).toBe(4);
    expect(response.body.data.stockMovement.reference).toBe("SO-TEST-001");
  });

  it("should reject goods issue when stock quantity is insufficient", async () => {
    const accessToken = await registerAndLoginAdmin();

    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id);

    await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        stockId: stock._id,
        quantity: 2,
        reference: "PO-LOW-STOCK-001",
        reason: "Prepare low stock",
      });

    const response = await request(app)
      .post("/api/goods-issues")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        stockId: stock._id,
        quantity: 5,
        reference: "SO-TOO-MUCH-001",
        reason: "Insufficient stock test",
      });

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toBe("Not enough stock available");
  });

  it("should reject goods issue without access token", async () => {
    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id);

    const response = await request(app)
      .post("/api/goods-issues")
      .send({
        stockId: stock._id,
        quantity: 1,
        reference: "SO-NO-TOKEN-001",
        reason: "Missing token test",
      });

    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Access token is required");
  });

  it("should reject goods issue for viewer role", async () => {
    const viewerAccessToken = await createViewerToken();

    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id);

    const response = await request(app)
      .post("/api/goods-issues")
      .set("Authorization", `Bearer ${viewerAccessToken}`)
      .send({
        stockId: stock._id,
        quantity: 1,
        reference: "SO-VIEWER-001",
        reason: "Viewer role test",
      });

    expect(response.statusCode).toBe(403);
    expect(response.body.message).toBe("Access denied");
  });

  it("bulk receives goods and accumulates quantities for the same stock", async () => {
    const managerToken = await createManagerToken();
    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id);

    const response = await request(app)
      .post("/api/goods-receipts/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          stockId: stock._id.toString(),
          quantity: 4,
          reference: "PO-BULK-001",
        },
        {
          stockId: stock._id.toString(),
          quantity: 6,
          reference: "PO-BULK-002",
        },
      ]);

    expect(response.statusCode).toBe(201);
    expect(response.body.data.processedCount).toBe(2);
    expect((await Stock.findById(stock._id)).quantity).toBe(10);
    expect(await StockMovement.countDocuments({ type: "GOODS_RECEIPT" })).toBe(2);
  });

  it("bulk issues goods and accumulates quantities for the same stock", async () => {
    const adminToken = await createAdminToken();
    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id, 12);

    const response = await request(app)
      .post("/api/goods-issues/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send([
        {
          stockId: stock._id.toString(),
          quantity: 3,
          reference: "SO-BULK-001",
        },
        {
          stockId: stock._id.toString(),
          quantity: 4,
          reference: "SO-BULK-002",
        },
      ]);

    expect(response.statusCode).toBe(201);
    expect(response.body.data.processedCount).toBe(2);
    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments({ type: "GOODS_ISSUE" })).toBe(2);
  });

  it("rejects a bulk goods issue when combined quantities are insufficient", async () => {
    const managerToken = await createManagerToken();
    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id, 5);

    const response = await request(app)
      .post("/api/goods-issues/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { stockId: stock._id.toString(), quantity: 3 },
        { stockId: stock._id.toString(), quantity: 3 },
      ]);

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toBe("Not enough stock available");
    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it("rejects bulk goods workflows for viewers", async () => {
    const viewerToken = await createViewerToken();
    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id, 5);
    const authorization = `Bearer ${viewerToken}`;

    const [receiptResponse, issueResponse] = await Promise.all([
      request(app)
        .post("/api/goods-receipts/bulk")
        .set("Authorization", authorization)
        .send([{ stockId: stock._id.toString(), quantity: 1 }]),
      request(app)
        .post("/api/goods-issues/bulk")
        .set("Authorization", authorization)
        .send([{ stockId: stock._id.toString(), quantity: 1 }]),
    ]);

    expect(receiptResponse.statusCode).toBe(403);
    expect(issueResponse.statusCode).toBe(403);
  });

  it("rejects unauthenticated bulk goods workflows", async () => {
    const product = await createProduct();
    const warehouse = await createWarehouse();
    const stock = await createStock(product._id, warehouse._id, 5);
    const body = [{ stockId: stock._id.toString(), quantity: 1 }];

    const [receiptResponse, issueResponse] = await Promise.all([
      request(app).post("/api/goods-receipts/bulk").send(body),
      request(app).post("/api/goods-issues/bulk").send(body),
    ]);

    expect(receiptResponse.statusCode).toBe(401);
    expect(issueResponse.statusCode).toBe(401);
  });
});
