const request = require("supertest");

const app = require("../src/app");

require("./setupTestDb");

const registerAndLoginAdmin = async () => {
  await request(app)
    .post("/api/auth/register")
    .send({
      name: "Workflow Admin",
      email: "workflow.admin@example.com",
      password: "Password123",
      role: "admin",
    });

  const loginResponse = await request(app)
    .post("/api/auth/login")
    .send({
      email: "workflow.admin@example.com",
      password: "Password123",
    });

  return loginResponse.body.data.accessToken;
};

const createProduct = async () => {
  const response = await request(app)
    .post("/api/products")
    .send({
      sku: "WORKFLOW-PRODUCT-001",
      name: "Workflow Product",
      unit: "piece",
    });

  return response.body.data;
};

const createWarehouse = async () => {
  const response = await request(app)
    .post("/api/warehouses")
    .send({
      code: "WH-WORKFLOW-001",
      name: "Workflow Warehouse",
    });

  return response.body.data;
};

const createStock = async (productId, warehouseId) => {
  const response = await request(app)
    .post("/api/stocks")
    .send({
      productId,
      warehouseId,
    });

  return response.body.data;
};

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

    expect(response.body.data.stock._id).toBe(stock._id);
    expect(response.body.data.stock.quantity).toBe(10);

    expect(response.body.data.stockMovement.stockId).toBe(stock._id);
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
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Workflow Viewer",
        email: "workflow.viewer@example.com",
        password: "Password123",
        role: "viewer",
      });

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({
        email: "workflow.viewer@example.com",
        password: "Password123",
      });

    const viewerAccessToken = loginResponse.body.data.accessToken;

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

    expect(response.body.data.stock._id).toBe(stock._id);
    expect(response.body.data.stock.quantity).toBe(6);

    expect(response.body.data.stockMovement.stockId).toBe(stock._id);
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
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Issue Viewer",
        email: "issue.viewer@example.com",
        password: "Password123",
        role: "viewer",
      });

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({
        email: "issue.viewer@example.com",
        password: "Password123",
      });

    const viewerAccessToken = loginResponse.body.data.accessToken;

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
});