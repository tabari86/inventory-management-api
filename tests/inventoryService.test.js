const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const inventoryService = require("../src/services/inventoryService");

require("./setupTestDb");

const createStock = async (quantity = 0) => {
  const [product, warehouse] = await Promise.all([
    Product.create({
      sku: "SERVICE-INVENTORY-001",
      name: "Service Inventory Product",
    }),
    Warehouse.create({
      code: "WH-SERVICE-INVENTORY",
      name: "Service Inventory Warehouse",
    }),
  ]);

  return Stock.create({
    productId: product._id,
    warehouseId: warehouse._id,
    quantity,
  });
};

describe("Inventory application service", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("receives goods without an Express request or response", async () => {
    const stock = await createStock();

    const result = await inventoryService.createGoodsReceipt({
      stockId: stock._id.toString(),
      quantity: 5,
      reference: "PO-SERVICE-001",
      reason: "Direct service test",
    });

    expect(result.stock.quantity).toBe(5);
    expect(result.stockMovement.type).toBe("GOODS_RECEIPT");
    expect(result.stockMovement.reference).toBe("PO-SERVICE-001");
    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(1);
  });

  it("issues goods without an Express request or response", async () => {
    const stock = await createStock(8);

    const result = await inventoryService.createGoodsIssue({
      stockId: stock._id.toString(),
      quantity: 3,
      reference: "SO-SERVICE-001",
    });

    expect(result.stock.quantity).toBe(5);
    expect(result.stockMovement.type).toBe("GOODS_ISSUE");
    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(1);
  });

  it("throws a typed error without reducing insufficient Stock", async () => {
    const stock = await createStock(2);
    let error;

    try {
      await inventoryService.createGoodsIssue({
        stockId: stock._id.toString(),
        quantity: 3,
      });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      name: "DomainError",
      code: errorCodes.INSUFFICIENT_STOCK,
      httpStatus: 409,
      message: "Not enough stock available",
    });
    expect((await Stock.findById(stock._id)).quantity).toBe(2);
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it("compensates a receipt and preserves the original movement failure", async () => {
    const stock = await createStock(5);
    const movementError = new Error("simulated direct receipt failure");
    jest.spyOn(StockMovement, "create").mockRejectedValueOnce(movementError);

    await expect(
      inventoryService.createGoodsReceipt({
        stockId: stock._id.toString(),
        quantity: 3,
      })
    ).rejects.toBe(movementError);

    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it("compensates an issue and preserves the original movement failure", async () => {
    const stock = await createStock(5);
    const movementError = new Error("simulated direct issue failure");
    jest.spyOn(StockMovement, "create").mockRejectedValueOnce(movementError);

    await expect(
      inventoryService.createGoodsIssue({
        stockId: stock._id.toString(),
        quantity: 3,
      })
    ).rejects.toBe(movementError);

    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it("groups repeated receipt Stock IDs and keeps one movement per input", async () => {
    const stock = await createStock(1);

    const result = await inventoryService.createGoodsReceiptsBulk({
      receipts: [
        {
          stockId: stock._id.toString(),
          quantity: 2,
          reference: "PO-DIRECT-001",
        },
        {
          stockId: stock._id.toString(),
          quantity: 3,
          reference: "PO-DIRECT-002",
        },
      ],
    });

    expect(result.processedCount).toBe(2);
    expect(result.stockMovements).toHaveLength(2);
    expect(result.stockMovements.map((movement) => movement.reference)).toEqual([
      "PO-DIRECT-001",
      "PO-DIRECT-002",
    ]);
    expect(result.updatedStocks).toHaveLength(1);
    expect(result.updatedStocks[0].quantity).toBe(6);
  });

  it("groups repeated issue Stock IDs without making Stock negative", async () => {
    const stock = await createStock(5);

    const result = await inventoryService.createGoodsIssuesBulk({
      issues: [
        {
          stockId: stock._id.toString(),
          quantity: 2,
          reference: "SO-DIRECT-001",
        },
        {
          stockId: stock._id.toString(),
          quantity: 3,
          reference: "SO-DIRECT-002",
        },
      ],
    });

    expect(result.processedCount).toBe(2);
    expect(result.stockMovements).toHaveLength(2);
    expect(result.stockMovements.map((movement) => movement.reference)).toEqual([
      "SO-DIRECT-001",
      "SO-DIRECT-002",
    ]);
    expect((await Stock.findById(stock._id)).quantity).toBe(0);
  });

  it("enforces combined sufficiency for repeated issue Stock IDs", async () => {
    const stock = await createStock(5);

    await expect(
      inventoryService.createGoodsIssuesBulk({
        issues: [
          { stockId: stock._id.toString(), quantity: 3 },
          { stockId: stock._id.toString(), quantity: 3 },
        ],
      })
    ).rejects.toMatchObject({
      code: errorCodes.INSUFFICIENT_STOCK,
      httpStatus: 409,
    });

    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(0);
  });
});
