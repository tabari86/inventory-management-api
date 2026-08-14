const fs = require("fs");
const path = require("path");
const request = require("supertest");

const app = require("../src/app");
const AuditEvent = require("../src/models/AuditEvent");
const OutboxEvent = require("../src/models/OutboxEvent");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const {
  mutationOperationRegistry,
} = require("../src/services/inventoryOperationRegistry");
const {
  createAdminToken,
  createManagerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const fixture = async ({ quantity = 0, stocks = 1 } = {}) => {
  const product = await Product.create({ sku: "COVER-EVENT-1", name: "Product" });
  const warehouse = await Warehouse.create({ code: "COVER-EVENT-W", name: "Warehouse" });
  const stockRows = [];
  for (let index = 0; index < stocks; index += 1) {
    const currentWarehouse =
      index === 0
        ? warehouse
        : await Warehouse.create({
            code: `COVER-EVENT-W-${index}`,
            name: `Warehouse ${index}`,
          });
    stockRows.push(
      await Stock.create({
        productId: product._id,
        warehouseId: currentWarehouse._id,
        quantity,
      })
    );
  }
  return { product, warehouse, stocks: stockRows };
};

describe("Audit/outbox mutation coverage", () => {
  it("keeps all 18 registered mutations on the common executor and models out of domain services", () => {
    expect(mutationOperationRegistry).toHaveLength(18);
    expect(new Set(mutationOperationRegistry.map(({ operationId }) => operationId)).size).toBe(18);

    const controllerFiles = [
      "productController.js",
      "warehouseController.js",
      "stockController.js",
      "goodsReceiptController.js",
      "goodsIssueController.js",
    ];
    const combinedControllers = controllerFiles
      .map((file) =>
        fs.readFileSync(path.join(__dirname, "../src/controllers", file), "utf8")
      )
      .join("\n");
    expect((combinedControllers.match(/sendInventoryMutation\(\{/g) || [])).toHaveLength(18);
    expect((combinedControllers.match(/execute: \(\{ session, eventCollector \}\)/g) || [])).toHaveLength(18);

    for (const file of [
      "productService.js",
      "warehouseService.js",
      "stockService.js",
      "inventoryService.js",
    ]) {
      const source = fs.readFileSync(
        path.join(__dirname, "../src/services", file),
        "utf8"
      );
      expect(source).not.toMatch(/models[\\/]AuditEvent|models[\\/]OutboxEvent/);
      expect(source).not.toMatch(/Promise\.all|Promise\.allSettled|\.forEach\(async/);
    }
  });

  it("Stock create emits one Stock pair and one pair for each actual parent touch", async () => {
    const token = await createManagerToken();
    const product = await Product.create({ sku: "STOCK-EVENT-1", name: "Product" });
    const warehouse = await Warehouse.create({ code: "STOCK-EVENT-W", name: "Warehouse" });
    const response = await request(app)
      .post("/api/stocks")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId: product._id, warehouseId: warehouse._id });

    expect(response.status).toBe(201);
    const audits = await AuditEvent.find({}).lean();
    const outboxes = await OutboxEvent.find({}).lean();
    expect(audits).toHaveLength(3);
    expect(outboxes.map(({ eventType }) => eventType)).toEqual([
      "inventory.stock.created",
      "catalog.product.stock-linked",
      "warehouse.stock-linked",
    ]);
    expect(outboxes.map(({ aggregate }) => aggregate.version)).toEqual([1, 2, 2]);
    expect(outboxes[1].payload.linkedStockIds).toEqual([response.body.data._id]);
    expect(outboxes[2].payload.linkedCount).toBe(1);
  });

  it("bulk Stock creation emits exact distinct parent touches and link sets", async () => {
    const token = await createManagerToken();
    const products = await Product.create([
      { sku: "STOCK-BULK-EVENT-1", name: "One" },
      { sku: "STOCK-BULK-EVENT-2", name: "Two" },
    ]);
    const warehouse = await Warehouse.create({
      code: "STOCK-BULK-EVENT-W",
      name: "Shared warehouse",
    });
    const response = await request(app)
      .post("/api/stocks/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send(
        products.map(({ _id }) => ({
          productId: _id,
          warehouseId: warehouse._id,
        }))
      );

    expect(response.status).toBe(201);
    const stockIds = response.body.data.stocks
      .map(({ _id }) => _id)
      .sort();
    const events = await OutboxEvent.find({}).sort({ _id: 1 }).lean();
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "inventory.stock.created",
      "inventory.stock.created",
      "catalog.product.stock-linked",
      "catalog.product.stock-linked",
      "warehouse.stock-linked",
    ]);
    expect(events.slice(0, 2).map(({ aggregate }) => aggregate.id).sort()).toEqual(
      stockIds
    );
    expect(events.slice(0, 2).map(({ aggregate }) => aggregate.version)).toEqual([
      1,
      1,
    ]);
    expect(events.slice(2, 4).map(({ aggregate }) => aggregate.id).sort()).toEqual(
      products.map(({ _id }) => _id.toString()).sort()
    );
    expect(events.slice(2, 4).map(({ aggregate }) => aggregate.version)).toEqual([
      2,
      2,
    ]);
    expect(events[4]).toMatchObject({
      aggregate: { id: warehouse._id.toString(), version: 2 },
      payload: { linkedStockIds: stockIds, linkedCount: 2 },
    });
    expect((await Warehouse.findById(warehouse._id)).version).toBe(2);
    expect((await Product.find({ _id: { $in: products.map(({ _id }) => _id) } }))
      .map(({ version }) => version)).toEqual([2, 2]);
    expect(await AuditEvent.countDocuments()).toBe(5);
  });

  it("lifecycle propagation emits one Product and one Stock guard pair per changed aggregate", async () => {
    const token = await createManagerToken();
    const { product, stocks } = await fixture({ stocks: 2 });
    const response = await request(app)
      .patch(`/api/products/${product._id}/deactivate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ deactivationReason: "planned", expectedVersion: product.version });

    expect(response.status).toBe(200);
    const events = await OutboxEvent.find({}).sort({ createdAt: 1 }).lean();
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "catalog.product.deactivated",
      "inventory.stock.availability-guard-changed",
      "inventory.stock.availability-guard-changed",
    ]);
    expect(events.slice(1).map(({ aggregate }) => aggregate.id).sort()).toEqual(
      stocks.map(({ _id }) => _id.toString()).sort()
    );
    expect(await AuditEvent.countDocuments()).toBe(3);
  });

  it("Warehouse lifecycle propagation emits exact guard causes and versions", async () => {
    const token = await createManagerToken();
    const products = await Product.create([
      { sku: "WAREHOUSE-GUARD-1", name: "One" },
      { sku: "WAREHOUSE-GUARD-2", name: "Two" },
    ]);
    const warehouse = await Warehouse.create({
      code: "WAREHOUSE-GUARD-W",
      name: "Guard warehouse",
    });
    const stocks = await Stock.create(
      products.map(({ _id }) => ({
        productId: _id,
        warehouseId: warehouse._id,
        quantity: 0,
      }))
    );
    const response = await request(app)
      .patch(`/api/warehouses/${warehouse._id}/deactivate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ deactivationReason: "planned", expectedVersion: warehouse.version });

    expect(response.status).toBe(200);
    const events = await OutboxEvent.find({}).sort({ _id: 1 }).lean();
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "warehouse.deactivated",
      "inventory.stock.availability-guard-changed",
      "inventory.stock.availability-guard-changed",
    ]);
    expect(events.slice(1).map(({ aggregate }) => aggregate.id).sort()).toEqual(
      stocks.map(({ _id }) => _id.toString()).sort()
    );
    for (const event of events.slice(1)) {
      expect(event).toMatchObject({
        aggregate: { type: "Stock", version: 2 },
        payload: {
          cause: {
            aggregateType: "Warehouse",
            aggregateId: warehouse._id.toString(),
            aggregateVersion: 2,
          },
          beforeGuard: { warehouseLifecycleStatus: "active" },
          afterGuard: { warehouseLifecycleStatus: "inactive" },
          aggregateVersion: 2,
        },
      });
    }
    expect(await AuditEvent.countDocuments()).toBe(3);
  });

  it("Product archive remains non-destructive with a non-null archived snapshot", async () => {
    const token = await createAdminToken();
    const product = await Product.create({
      sku: "ARCHIVE-EVENT-1",
      name: "Archived product",
      status: "inactive",
    });
    const warehouse = await Warehouse.create({
      code: "ARCHIVE-EVENT-W",
      name: "Archive warehouse",
    });
    const stock = await Stock.create({
      productId: product._id,
      warehouseId: warehouse._id,
      productLifecycleStatus: "inactive",
      quantity: 0,
    });
    const response = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ archiveReason: "retired", expectedVersion: product.version });

    expect(response.status).toBe(200);
    const persisted = await Product.findById(product._id).lean();
    expect(persisted).toMatchObject({ version: 2, archiveReason: "retired" });
    expect(persisted.archivedAt).toEqual(expect.any(Date));
    const audit = await AuditEvent.findOne({ "resource.type": "Product" }).lean();
    const outboxes = await OutboxEvent.find({}).sort({ _id: 1 }).lean();
    expect(audit).toMatchObject({
      resource: { id: product._id.toString(), aggregateVersion: 2 },
      before: expect.any(Object),
      after: expect.any(Object),
    });
    expect(audit.after.snapshot.archivedAt).toEqual(expect.any(String));
    expect(outboxes[0]).toMatchObject({
      eventType: "catalog.product.archived",
      aggregate: { id: product._id.toString(), version: 2 },
    });
    expect(outboxes[1]).toMatchObject({
      eventType: "inventory.stock.availability-guard-changed",
      aggregate: { id: stock._id.toString(), version: 2 },
      payload: {
        beforeGuard: { productLifecycleStatus: "inactive" },
        afterGuard: { productLifecycleStatus: "archived" },
      },
    });
    expect(await Stock.findById(stock._id).lean()).toMatchObject({
      productLifecycleStatus: "archived",
      version: 2,
    });
  });

  it("repeated bulk receipts preserve movement order, quantities, and sequential versions", async () => {
    const token = await createManagerToken();
    const { stocks } = await fixture();
    const stock = stocks[0];
    const response = await request(app)
      .post("/api/goods-receipts/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send([
        { stockId: stock._id, quantity: 2, reference: "PO-A" },
        { stockId: stock._id, quantity: 3, reference: "PO-B" },
      ]);

    expect(response.status).toBe(201);
    const movements = await StockMovement.find({}).sort({ createdAt: 1 }).lean();
    const outboxes = await OutboxEvent.find({}).sort({ createdAt: 1 }).lean();
    expect(movements.map(({ quantityBefore, quantityAfter, aggregateVersion }) => ({
      quantityBefore,
      quantityAfter,
      aggregateVersion,
    }))).toEqual([
      { quantityBefore: 0, quantityAfter: 2, aggregateVersion: 2 },
      { quantityBefore: 2, quantityAfter: 5, aggregateVersion: 3 },
    ]);
    expect(outboxes.map(({ aggregate }) => aggregate.version)).toEqual([2, 3]);
    expect(outboxes.map(({ payload }) => payload.signedDelta)).toEqual([2, 3]);
    expect(outboxes.map(({ payload }) => payload.stockMovementId)).toEqual(
      movements.map(({ _id }) => _id.toString())
    );
    expect(outboxes.map(({ payload }) => payload.beforeQuantity)).toEqual([0, 2]);
    expect(outboxes.map(({ payload }) => payload.afterQuantity)).toEqual([2, 5]);
    expect(outboxes.map(({ payload }) => payload.reference)).toEqual([
      "PO-A",
      "PO-B",
    ]);
    expect(outboxes.map(({ payload }) => payload.reasonCode)).toEqual([
      "GOODS_RECEIPT",
      "GOODS_RECEIPT",
    ]);
    expect(outboxes.every(({ payload }) => payload.productId === stock.productId.toString())).toBe(true);
    expect(outboxes.every(({ payload }) => payload.warehouseId === stock.warehouseId.toString())).toBe(true);
    expect(await Stock.findById(stock._id).lean()).toMatchObject({
      quantity: 5,
      version: 3,
    });
    expect(await AuditEvent.countDocuments()).toBe(2);
  });

  it("repeated bulk issues preserve exact movement order and sequential versions", async () => {
    const token = await createManagerToken();
    const { stocks } = await fixture({ quantity: 10 });
    const stock = stocks[0];
    const response = await request(app)
      .post("/api/goods-issues/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send([
        { stockId: stock._id, quantity: 2, reference: "SO-A" },
        { stockId: stock._id, quantity: 3, reference: "SO-B" },
      ]);

    expect(response.status).toBe(201);
    const movements = await StockMovement.find({}).sort({ _id: 1 }).lean();
    const outboxes = await OutboxEvent.find({}).sort({ _id: 1 }).lean();
    expect(
      movements.map(({ quantityBefore, quantityAfter, aggregateVersion }) => ({
        quantityBefore,
        quantityAfter,
        aggregateVersion,
      }))
    ).toEqual([
      { quantityBefore: 10, quantityAfter: 8, aggregateVersion: 2 },
      { quantityBefore: 8, quantityAfter: 5, aggregateVersion: 3 },
    ]);
    expect(outboxes.map(({ eventType }) => eventType)).toEqual([
      "inventory.stock.issued",
      "inventory.stock.issued",
    ]);
    expect(outboxes.map(({ aggregate }) => aggregate.version)).toEqual([2, 3]);
    expect(outboxes.map(({ payload }) => payload.stockMovementId)).toEqual(
      movements.map(({ _id }) => _id.toString())
    );
    expect(outboxes.map(({ payload }) => payload.signedDelta)).toEqual([-2, -3]);
    expect(outboxes.map(({ payload }) => payload.beforeQuantity)).toEqual([10, 8]);
    expect(outboxes.map(({ payload }) => payload.afterQuantity)).toEqual([8, 5]);
    expect(outboxes.map(({ payload }) => payload.reference)).toEqual([
      "SO-A",
      "SO-B",
    ]);
    expect(await Stock.findById(stock._id).lean()).toMatchObject({
      quantity: 5,
      version: 3,
    });
    expect(await AuditEvent.countDocuments()).toBe(2);
  });

  it("enforces event-pair identity for every changed transition", async () => {
    const token = await createManagerToken();
    await request(app)
      .post("/api/products/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send([
        { sku: "PAIR-COVER-1", name: "One" },
        { sku: "PAIR-COVER-2", name: "Two" },
      ]);
    const audits = await AuditEvent.find({}).sort({ createdAt: 1 }).lean();
    const outboxes = await OutboxEvent.find({}).sort({ createdAt: 1 }).lean();
    expect(audits).toHaveLength(outboxes.length);
    for (let index = 0; index < audits.length; index += 1) {
      expect(outboxes[index]).toMatchObject({
        aggregate: {
          type: audits[index].resource.type,
          id: audits[index].resource.id,
          version: audits[index].resource.aggregateVersion,
        },
        requestId: audits[index].requestId,
        correlationId: audits[index].correlationId,
        causationId: audits[index].causationId,
        idempotency: audits[index].idempotency,
      });
      expect(outboxes[index].occurredAt).toEqual(audits[index].occurredAt);
    }
  });
});
