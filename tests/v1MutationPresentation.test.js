const request = require("supertest");

const app = require("../src/app");
const swaggerSpec = require("../src/config/swagger");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const Warehouse = require("../src/models/Warehouse");
const { createAdminToken } = require("./helpers/authTestHelper");
const {
  expectNoForbiddenFields,
  expectOnlyKeys,
} = require("./helpers/publicContractAssertions");

require("./setupTestDb");

const resourceSchema = (name) => swaggerSpec.components.schemas[name];
const expectResource = (value, schemaName) => {
  const schema = resourceSchema(schemaName);
  expectOnlyKeys(value, Object.keys(schema.properties), schema.required);
  expectNoForbiddenFields(value);
};

const expectV1Envelope = (response) => {
  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  expect(Object.keys(response.body).sort()).toEqual(["data", "meta"]);
  expect(Object.keys(response.body.meta).sort()).toEqual(
    ["correlationId", "requestId", "schemaVersion"].sort()
  );
  expect(response.body.meta.schemaVersion).toBe("1.0");
  expectNoForbiddenFields(response.body);
};

const authRequest = (method, path, token) =>
  request(app)[method](path).set("Authorization", `Bearer ${token}`);

describe("Canonical v1 mutation DTO presentation", () => {
  it("presents bounded Product create, update, bulk, deactivate, and archive results", async () => {
    const token = await createAdminToken();
    const created = await authRequest("post", "/api/v1/products", token).send({
      sku: "DTO-PRODUCT-1",
      name: "DTO Product",
      description: "Public description",
    });
    expectV1Envelope(created);
    expectResource(created.body.data, "Product");
    expect(created.body.data).toMatchObject({ version: 1, sku: "DTO-PRODUCT-1" });

    const updated = await authRequest(
      "patch",
      `/api/v1/products/${created.body.data._id}`,
      token
    ).send({ name: "Updated DTO Product", expectedVersion: 1 });
    expectV1Envelope(updated);
    expectResource(updated.body.data, "Product");
    expect(updated.body.data.version).toBe(2);

    const bulkCreated = await authRequest(
      "post",
      "/api/v1/products/bulk",
      token
    ).send([
      { sku: "DTO-PRODUCT-B1", name: "Bulk One" },
      { sku: "DTO-PRODUCT-B2", name: "Bulk Two" },
    ]);
    expectV1Envelope(bulkCreated);
    expectOnlyKeys(bulkCreated.body.data, [
      "createdCount",
      "updatedCount",
      "deletedCount",
      "products",
    ], ["createdCount", "products"]);
    bulkCreated.body.data.products.forEach((product) =>
      expectResource(product, "Product")
    );

    const bulkUpdated = await authRequest(
      "patch",
      "/api/v1/products/bulk",
      token
    ).send(
      bulkCreated.body.data.products.map((product, index) => ({
        id: product._id,
        name: `Bulk Updated ${index + 1}`,
        expectedVersion: product.version,
      }))
    );
    expectV1Envelope(bulkUpdated);
    expectOnlyKeys(
      bulkUpdated.body.data,
      ["createdCount", "updatedCount", "deletedCount", "products"],
      ["updatedCount", "products"]
    );
    bulkUpdated.body.data.products.forEach((product) =>
      expectResource(product, "Product")
    );

    const deactivated = await authRequest(
      "patch",
      `/api/v1/products/${created.body.data._id}/deactivate`,
      token
    ).send({ expectedVersion: updated.body.data.version, deactivationReason: "DTO test" });
    expectV1Envelope(deactivated);
    expectResource(deactivated.body.data, "Product");
    expect(deactivated.body.data).toMatchObject({
      status: "inactive",
      version: 3,
      deactivationReason: "DTO test",
    });

    const archived = await authRequest(
      "delete",
      `/api/v1/products/${created.body.data._id}`,
      token
    ).send({ expectedVersion: deactivated.body.data.version, archiveReason: "DTO test" });
    expectV1Envelope(archived);
    expect(archived.body.data).toBeNull();
  });

  it("presents bounded Warehouse create, update, bulk, and lifecycle results", async () => {
    const token = await createAdminToken();
    const created = await authRequest("post", "/api/v1/warehouses", token).send({
      code: "DTO-WAREHOUSE-1",
      name: "DTO Warehouse",
    });
    expectV1Envelope(created);
    expectResource(created.body.data, "Warehouse");
    expect(created.body.data.version).toBe(1);

    const updated = await authRequest(
      "patch",
      `/api/v1/warehouses/${created.body.data._id}`,
      token
    ).send({ name: "Updated DTO Warehouse", expectedVersion: 1 });
    expectV1Envelope(updated);
    expectResource(updated.body.data, "Warehouse");
    expect(updated.body.data.version).toBe(2);

    const bulkCreated = await authRequest(
      "post",
      "/api/v1/warehouses/bulk",
      token
    ).send([
      { code: "DTO-WAREHOUSE-B1", name: "Bulk One" },
      { code: "DTO-WAREHOUSE-B2", name: "Bulk Two" },
    ]);
    expectV1Envelope(bulkCreated);
    expectOnlyKeys(
      bulkCreated.body.data,
      ["createdCount", "updatedCount", "warehouses"],
      ["createdCount", "warehouses"]
    );
    bulkCreated.body.data.warehouses.forEach((warehouse) =>
      expectResource(warehouse, "Warehouse")
    );

    const bulkUpdated = await authRequest(
      "patch",
      "/api/v1/warehouses/bulk",
      token
    ).send(
      bulkCreated.body.data.warehouses.map((warehouse, index) => ({
        id: warehouse._id,
        name: `Bulk Updated ${index + 1}`,
        expectedVersion: warehouse.version,
      }))
    );
    expectV1Envelope(bulkUpdated);
    expectOnlyKeys(
      bulkUpdated.body.data,
      ["createdCount", "updatedCount", "warehouses"],
      ["updatedCount", "warehouses"]
    );
    bulkUpdated.body.data.warehouses.forEach((warehouse) =>
      expectResource(warehouse, "Warehouse")
    );

    const deactivated = await authRequest(
      "patch",
      `/api/v1/warehouses/${created.body.data._id}/deactivate`,
      token
    ).send({ expectedVersion: updated.body.data.version, deactivationReason: "DTO test" });
    expectV1Envelope(deactivated);
    expectResource(deactivated.body.data, "Warehouse");
    expect(deactivated.body.data).toMatchObject({
      status: "inactive",
      version: 3,
      deactivationReason: "DTO test",
    });
  });

  it("presents bounded Stock single and bulk creation results", async () => {
    const token = await createAdminToken();
    const products = await Product.create([
      { sku: "DTO-STOCK-P1", name: "Stock Product One" },
      { sku: "DTO-STOCK-P2", name: "Stock Product Two" },
      { sku: "DTO-STOCK-P3", name: "Stock Product Three" },
    ]);
    const warehouse = await Warehouse.create({
      code: "DTO-STOCK-W1",
      name: "Stock Warehouse",
    });

    const created = await authRequest("post", "/api/v1/stocks", token).send({
      productId: products[0]._id.toString(),
      warehouseId: warehouse._id.toString(),
    });
    expectV1Envelope(created);
    expectResource(created.body.data, "Stock");
    expect(created.body.data).toMatchObject({ quantity: 0, version: 1 });

    const bulkCreated = await authRequest(
      "post",
      "/api/v1/stocks/bulk",
      token
    ).send(
      products.slice(1).map((product) => ({
        productId: product._id.toString(),
        warehouseId: warehouse._id.toString(),
      }))
    );
    expectV1Envelope(bulkCreated);
    expectOnlyKeys(bulkCreated.body.data, ["createdCount", "stocks"], [
      "createdCount",
      "stocks",
    ]);
    bulkCreated.body.data.stocks.forEach((stock) =>
      expectResource(stock, "Stock")
    );
  });

  it("presents bounded goods receipt and issue compound results", async () => {
    const token = await createAdminToken();
    const product = await Product.create({
      sku: "DTO-INVENTORY-P1",
      name: "Inventory Product",
    });
    const warehouse = await Warehouse.create({
      code: "DTO-INVENTORY-W1",
      name: "Inventory Warehouse",
    });
    const stock = await Stock.create({
      productId: product._id,
      warehouseId: warehouse._id,
    });

    const receipt = await authRequest(
      "post",
      "/api/v1/goods-receipts",
      token
    ).send({ stockId: stock._id.toString(), quantity: 10, reference: "DTO-R" });
    expectV1Envelope(receipt);
    expectOnlyKeys(receipt.body.data, ["stock", "stockMovement"], [
      "stock",
      "stockMovement",
    ]);
    expectResource(receipt.body.data.stock, "Stock");
    expectResource(receipt.body.data.stockMovement, "StockMovement");
    expect(receipt.body.data.stock.version).toBe(2);
    expect(receipt.body.data.stockMovement.aggregateVersion).toBe(2);

    const issue = await authRequest(
      "post",
      "/api/v1/goods-issues",
      token
    ).send({ stockId: stock._id.toString(), quantity: 3, reference: "DTO-I" });
    expectV1Envelope(issue);
    expectOnlyKeys(issue.body.data, ["stock", "stockMovement"], [
      "stock",
      "stockMovement",
    ]);
    expectResource(issue.body.data.stock, "Stock");
    expectResource(issue.body.data.stockMovement, "StockMovement");
    expect(issue.body.data.stock.version).toBe(3);
    expect(issue.body.data.stockMovement.aggregateVersion).toBe(3);

    const bulkReceipt = await authRequest(
      "post",
      "/api/v1/goods-receipts/bulk",
      token
    ).send([{ stockId: stock._id.toString(), quantity: 2 }]);
    expectV1Envelope(bulkReceipt);
    expectOnlyKeys(
      bulkReceipt.body.data,
      ["processedCount", "stockMovements", "updatedStocks"],
      ["processedCount", "stockMovements", "updatedStocks"]
    );
    bulkReceipt.body.data.stockMovements.forEach((movement) =>
      expectResource(movement, "StockMovement")
    );
    bulkReceipt.body.data.updatedStocks.forEach((updatedStock) =>
      expectResource(updatedStock, "Stock")
    );

    const bulkIssue = await authRequest(
      "post",
      "/api/v1/goods-issues/bulk",
      token
    ).send([{ stockId: stock._id.toString(), quantity: 1 }]);
    expectV1Envelope(bulkIssue);
    expectOnlyKeys(
      bulkIssue.body.data,
      ["processedCount", "stockMovements", "updatedStocks"],
      ["processedCount", "stockMovements", "updatedStocks"]
    );
    bulkIssue.body.data.stockMovements.forEach((movement) =>
      expectResource(movement, "StockMovement")
    );
    bulkIssue.body.data.updatedStocks.forEach((updatedStock) =>
      expectResource(updatedStock, "Stock")
    );
  });
});
