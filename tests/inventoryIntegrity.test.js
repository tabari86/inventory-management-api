const mongoose = require("mongoose");
const request = require("supertest");

const app = require("../src/app");
const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const inventoryService = require("../src/services/inventoryService");
const productService = require("../src/services/productService");
const warehouseService = require("../src/services/warehouseService");
const { createManagerToken } = require("./helpers/authTestHelper");

require("./setupTestDb");

let sequence = 0;

const createInventory = async ({ quantity = 10 } = {}) => {
  sequence += 1;
  const product = await Product.create({
    sku: `INTEGRITY-${sequence}`,
    name: `Integrity Product ${sequence}`,
  });
  const warehouse = await Warehouse.create({
    code: `INTEGRITY-WH-${sequence}`,
    name: `Integrity Warehouse ${sequence}`,
  });
  const stock = await Stock.create({
    productId: product._id,
    warehouseId: warehouse._id,
    quantity,
  });

  return { product, warehouse, stock };
};

describe("Inventory lifecycle enforcement and movement history", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes direct references, bounded snapshots, quantities, and aggregate version", async () => {
    const { product, warehouse, stock } = await createInventory();

    const receipt = await inventoryService.createGoodsReceipt({
      stockId: stock._id.toString(),
      quantity: 4,
      reference: "PO-INTEGRITY",
      reason: "Receipt history",
    });

    expect(receipt.stock).toMatchObject({ quantity: 14, version: 2 });
    expect(receipt.stockMovement.toObject()).toMatchObject({
      stockId: stock._id,
      productId: product._id,
      warehouseId: warehouse._id,
      type: "GOODS_RECEIPT",
      quantity: 4,
      quantityBefore: 10,
      quantityAfter: 14,
      aggregateVersion: 2,
      productSnapshot: { sku: product.sku, name: product.name },
      warehouseSnapshot: { code: warehouse.code, name: warehouse.name },
    });

    const issue = await inventoryService.createGoodsIssue({
      stockId: stock._id.toString(),
      quantity: 3,
      reference: "SO-INTEGRITY",
    });
    expect(issue.stock).toMatchObject({ quantity: 11, version: 3 });
    expect(issue.stockMovement.toObject()).toMatchObject({
      quantityBefore: 14,
      quantityAfter: 11,
      aggregateVersion: 3,
    });
  });

  it("keeps movement snapshots immutable through parent rename and Product archive", async () => {
    const { product, warehouse, stock } = await createInventory();
    const originalProductName = product.name;
    const originalWarehouseName = warehouse.name;

    const { stockMovement } = await inventoryService.createGoodsReceipt({
      stockId: stock._id.toString(),
      quantity: 1,
    });
    await productService.updateProduct({
      productId: product._id,
      update: { name: "Renamed Product" },
    });
    await warehouseService.updateWarehouse({
      warehouseId: warehouse._id,
      update: { name: "Renamed Warehouse" },
    });
    await productService.deactivateProduct({ productId: product._id });
    await productService.archiveProduct({ productId: product._id });

    const persistedMovement = await StockMovement.findById(stockMovement._id)
      .populate("productId")
      .populate("warehouseId");
    expect(persistedMovement.productSnapshot.name).toBe(originalProductName);
    expect(persistedMovement.warehouseSnapshot.name).toBe(originalWarehouseName);
    expect(persistedMovement.productId.name).toBe("Renamed Product");
    expect(persistedMovement.productId.archivedAt).toEqual(expect.any(Date));
    expect(persistedMovement.warehouseId.name).toBe("Renamed Warehouse");
  });

  it("assigns sequential quantities and versions to repeated bulk Stock items", async () => {
    const { stock } = await createInventory();

    const result = await inventoryService.createGoodsReceiptsBulk({
      receipts: [
        { stockId: stock._id.toString(), quantity: 2, reference: "ORDER-1" },
        { stockId: stock._id.toString(), quantity: 3, reference: "ORDER-2" },
        { stockId: stock._id.toString(), quantity: 1, reference: "ORDER-3" },
      ],
    });

    expect(result.processedCount).toBe(3);
    expect(result.stockMovements.map((movement) => movement.reference)).toEqual([
      "ORDER-1",
      "ORDER-2",
      "ORDER-3",
    ]);
    expect(
      result.stockMovements.map(
        ({ quantityBefore, quantityAfter, aggregateVersion }) => ({
          quantityBefore,
          quantityAfter,
          aggregateVersion,
        })
      )
    ).toEqual([
      { quantityBefore: 10, quantityAfter: 12, aggregateVersion: 2 },
      { quantityBefore: 12, quantityAfter: 15, aggregateVersion: 3 },
      { quantityBefore: 15, quantityAfter: 16, aggregateVersion: 4 },
    ]);
    expect(await Stock.findById(stock._id)).toMatchObject({
      quantity: 16,
      version: 4,
    });
    expect(
      await StockMovement.distinct("aggregateVersion", { stockId: stock._id })
    ).toHaveLength(3);
  });

  it("rolls back quantity and version when movement persistence fails", async () => {
    const { stock } = await createInventory();
    const movementError = new Error("simulated movement failure");
    jest.spyOn(StockMovement, "create").mockRejectedValueOnce(movementError);

    const failure = await inventoryService
      .createGoodsReceipt({
        stockId: stock._id.toString(),
        quantity: 5,
      })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      cause: movementError,
    });

    expect(await Stock.findById(stock._id)).toMatchObject({
      quantity: 10,
      version: 1,
    });
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  const rejectionCases = [
    {
      state: "inactive Product",
      prepare: async ({ product }) =>
        Product.updateOne({ _id: product._id }, { $set: { status: "inactive" } }),
      code: "product",
    },
    {
      state: "archived Product",
      prepare: async ({ product }) =>
        Product.updateOne(
          { _id: product._id },
          { $set: { status: "inactive", archivedAt: new Date() } }
        ),
      code: "product",
    },
    {
      state: "inactive Warehouse",
      prepare: async ({ warehouse }) =>
        Warehouse.updateOne(
          { _id: warehouse._id },
          { $set: { status: "inactive" } }
        ),
      code: "warehouse",
    },
    {
      state: "inactive Stock",
      prepare: async ({ stock }) =>
        Stock.updateOne({ _id: stock._id }, { $set: { status: "inactive" } }),
      code: "stock",
    },
    {
      state: "missing Product reference",
      prepare: async ({ stock }) => {
        await Stock.updateOne(
          { _id: stock._id },
          { $set: { productId: new mongoose.Types.ObjectId() } }
        );
      },
      code: "missing-product",
    },
    {
      state: "missing Warehouse reference",
      prepare: async ({ stock }) => {
        await Stock.updateOne(
          { _id: stock._id },
          { $set: { warehouseId: new mongoose.Types.ObjectId() } }
        );
      },
      code: "missing-warehouse",
    },
    {
      state: "unresolved Product guard",
      prepare: async ({ stock }) =>
        Stock.collection.updateOne(
          { _id: stock._id },
          { $unset: { productLifecycleStatus: "" } }
        ),
      code: "product",
    },
    {
      state: "unresolved Warehouse guard",
      prepare: async ({ stock }) =>
        Stock.collection.updateOne(
          { _id: stock._id },
          { $unset: { warehouseLifecycleStatus: "" } }
        ),
      code: "warehouse",
    },
  ];

  it.each(
    rejectionCases.flatMap((testCase) =>
      ["receipt", "issue"].map((operation) => ({ ...testCase, operation }))
    )
  )(
    "rejects $operation against $state with no aggregate write",
    async ({ prepare, code, operation }) => {
      const token = await createManagerToken();
      const context = await createInventory();
      await prepare(context);

      const response = await request(app)
        .post(
          operation === "receipt"
            ? "/api/goods-receipts"
            : "/api/goods-issues"
        )
        .set("Authorization", `Bearer ${token}`)
        .send({ stockId: context.stock._id.toString(), quantity: 2 });

      const expectedMessage = {
        product:
          operation === "receipt"
            ? "Cannot receive goods for inactive product"
            : "Cannot issue goods for inactive product",
        warehouse:
          operation === "receipt"
            ? "Cannot receive goods into inactive warehouse"
            : "Cannot issue goods from inactive warehouse",
        stock:
          operation === "receipt"
            ? "Cannot receive goods into inactive stock"
            : "Cannot issue goods from inactive stock",
        "missing-product": "Product not found",
        "missing-warehouse": "Warehouse not found",
      }[code];

      expect(response.statusCode).toBe(code.startsWith("missing") ? 404 : 409);
      expect(response.body).toEqual({ message: expectedMessage });
      expect(await Stock.findById(context.stock._id)).toMatchObject({
        quantity: 10,
        version: 1,
      });
      expect(await StockMovement.countDocuments()).toBe(0);
    }
  );
});
