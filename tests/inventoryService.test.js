const mongoose = require("mongoose");

const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const inventoryService = require("../src/services/inventoryService");

require("./setupTestDb");

const createStock = async (quantity = 0, suffix = "001") => {
  const [product, warehouse] = await Promise.all([
    Product.create({
      sku: `SERVICE-INVENTORY-${suffix}`,
      name: "Service Inventory Product",
    }),
    Warehouse.create({
      code: `WH-SERVICE-INVENTORY-${suffix}`,
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

  it("aborts a receipt transaction and preserves the original movement failure", async () => {
    const stock = await createStock(5);
    const movementError = new Error("simulated direct receipt failure");
    const compensationSpy = jest.spyOn(Stock, "updateOne");
    jest.spyOn(StockMovement, "create").mockRejectedValueOnce(movementError);

    const failure = await inventoryService
      .createGoodsReceipt({
        stockId: stock._id.toString(),
        quantity: 3,
      })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      cause: movementError,
    });

    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(compensationSpy).not.toHaveBeenCalled();
  });

  it("aborts an issue transaction and preserves the original movement failure", async () => {
    const stock = await createStock(5);
    const movementError = new Error("simulated direct issue failure");
    const compensationSpy = jest.spyOn(Stock, "updateOne");
    jest.spyOn(StockMovement, "create").mockRejectedValueOnce(movementError);

    const failure = await inventoryService
      .createGoodsIssue({
        stockId: stock._id.toString(),
        quantity: 3,
      })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      cause: movementError,
    });

    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(compensationSpy).not.toHaveBeenCalled();
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

  it("commits grouped receipt updates for every Stock in one transaction", async () => {
    const firstStock = await createStock(1, "RECEIPT-SUCCESS-A");
    const secondStock = await createStock(2, "RECEIPT-SUCCESS-B");

    const result = await inventoryService.createGoodsReceiptsBulk({
      receipts: [
        {
          stockId: firstStock._id.toString(),
          quantity: 2,
          reference: "PO-MULTI-001",
        },
        {
          stockId: secondStock._id.toString(),
          quantity: 3,
          reference: "PO-MULTI-002",
        },
        {
          stockId: firstStock._id.toString(),
          quantity: 4,
          reference: "PO-MULTI-003",
        },
      ],
    });

    expect(result.processedCount).toBe(3);
    expect(result.stockMovements.map((movement) => movement.reference)).toEqual([
      "PO-MULTI-001",
      "PO-MULTI-002",
      "PO-MULTI-003",
    ]);
    expect(result.updatedStocks).toHaveLength(2);
    expect((await Stock.findById(firstStock._id)).quantity).toBe(7);
    expect((await Stock.findById(secondStock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(3);
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

  it("commits grouped issue updates for every Stock in one transaction", async () => {
    const firstStock = await createStock(10, "ISSUE-SUCCESS-A");
    const secondStock = await createStock(9, "ISSUE-SUCCESS-B");

    const result = await inventoryService.createGoodsIssuesBulk({
      issues: [
        {
          stockId: firstStock._id.toString(),
          quantity: 2,
          reference: "SO-MULTI-001",
        },
        {
          stockId: secondStock._id.toString(),
          quantity: 4,
          reference: "SO-MULTI-002",
        },
        {
          stockId: firstStock._id.toString(),
          quantity: 3,
          reference: "SO-MULTI-003",
        },
      ],
    });

    expect(result.processedCount).toBe(3);
    expect(result.stockMovements.map((movement) => movement.reference)).toEqual([
      "SO-MULTI-001",
      "SO-MULTI-002",
      "SO-MULTI-003",
    ]);
    expect(result.updatedStocks).toHaveLength(2);
    expect((await Stock.findById(firstStock._id)).quantity).toBe(5);
    expect((await Stock.findById(secondStock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(3);
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

  it("preserves missing and inactive receipt errors without writes", async () => {
    const missingStockId = new mongoose.Types.ObjectId().toString();

    await expect(
      inventoryService.createGoodsReceipt({
        stockId: missingStockId,
        quantity: 2,
      })
    ).rejects.toMatchObject({
      code: errorCodes.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      message: "Stock record not found",
    });

    const inactiveStock = await createStock(4, "INACTIVE");
    inactiveStock.status = "inactive";
    await inactiveStock.save();

    await expect(
      inventoryService.createGoodsReceipt({
        stockId: inactiveStock._id.toString(),
        quantity: 2,
      })
    ).rejects.toMatchObject({
      code: errorCodes.INACTIVE_STOCK,
      httpStatus: 409,
      message: "Cannot receive goods into inactive stock",
    });

    expect((await Stock.findById(inactiveStock._id)).quantity).toBe(4);
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it("aborts a bulk receipt including a partial session-bound movement insert", async () => {
    const firstStock = await createStock(5, "BULK-RECEIPT-A");
    const secondStock = await createStock(7, "BULK-RECEIPT-B");
    const movementError = new Error("simulated partial bulk receipt failure");
    const originalInsertMany = StockMovement.insertMany.bind(StockMovement);
    const compensationSpy = jest.spyOn(Stock, "updateOne");
    const movementDeleteSpy = jest.spyOn(StockMovement, "deleteMany");

    jest
      .spyOn(StockMovement, "insertMany")
      .mockImplementationOnce(async (documents, options) => {
        await originalInsertMany([documents[0]], options);
        throw movementError;
      });

    const failure = await inventoryService
      .createGoodsReceiptsBulk({
        receipts: [
          {
            stockId: firstStock._id.toString(),
            quantity: 2,
            reference: "PO-PARTIAL-001",
          },
          {
            stockId: secondStock._id.toString(),
            quantity: 3,
            reference: "PO-PARTIAL-002",
          },
        ],
      })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      cause: movementError,
    });

    expect((await Stock.findById(firstStock._id)).quantity).toBe(5);
    expect((await Stock.findById(secondStock._id)).quantity).toBe(7);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(compensationSpy).not.toHaveBeenCalled();
    expect(movementDeleteSpy).not.toHaveBeenCalled();
  });

  it("aborts every bulk issue update when movement insertion fails", async () => {
    const firstStock = await createStock(10, "BULK-ISSUE-A");
    const secondStock = await createStock(8, "BULK-ISSUE-B");
    const movementError = new Error("simulated bulk issue failure");
    const compensationSpy = jest.spyOn(Stock, "updateOne");
    const movementDeleteSpy = jest.spyOn(StockMovement, "deleteMany");

    jest.spyOn(StockMovement, "insertMany").mockRejectedValueOnce(movementError);

    const failure = await inventoryService
      .createGoodsIssuesBulk({
        issues: [
          { stockId: firstStock._id.toString(), quantity: 4 },
          { stockId: secondStock._id.toString(), quantity: 3 },
        ],
      })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      cause: movementError,
    });

    expect((await Stock.findById(firstStock._id)).quantity).toBe(10);
    expect((await Stock.findById(secondStock._id)).quantity).toBe(8);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(compensationSpy).not.toHaveBeenCalled();
    expect(movementDeleteSpy).not.toHaveBeenCalled();
  });

  it("keeps concurrent receipts consistent without lost updates", async () => {
    const stock = await createStock(10, "CONCURRENT-RECEIPT");

    const results = await Promise.all([
      inventoryService.createGoodsReceipt({
        stockId: stock._id.toString(),
        quantity: 4,
        reference: "PO-CONCURRENT-001",
      }),
      inventoryService.createGoodsReceipt({
        stockId: stock._id.toString(),
        quantity: 6,
        reference: "PO-CONCURRENT-002",
      }),
    ]);

    expect(results).toHaveLength(2);
    expect((await Stock.findById(stock._id)).quantity).toBe(20);
    expect(await StockMovement.countDocuments({ type: "GOODS_RECEIPT" })).toBe(2);
  });

  it("does not duplicate a receipt when the transaction callback is retried", async () => {
    const stock = await createStock(10, "TRANSIENT-RETRY");
    const originalCreate = StockMovement.create.bind(StockMovement);
    const transientError = new mongoose.mongo.MongoServerError({
      message: "simulated transient transaction failure",
    });
    transientError.addErrorLabel("TransientTransactionError");
    let movementAttempts = 0;

    jest.spyOn(StockMovement, "create").mockImplementation(async (...args) => {
      movementAttempts += 1;
      const movements = await originalCreate(...args);

      if (movementAttempts === 1) {
        throw transientError;
      }

      return movements;
    });

    const result = await inventoryService.createGoodsReceipt({
      stockId: stock._id.toString(),
      quantity: 4,
      reference: "PO-RETRY-001",
    });

    expect(movementAttempts).toBe(2);
    expect(result.stock.quantity).toBe(14);
    expect(result.stock.version).toBe(2);
    expect(result.stockMovement.aggregateVersion).toBe(2);
    expect(await Stock.findById(stock._id)).toMatchObject({
      quantity: 14,
      version: 2,
    });
    expect(await StockMovement.countDocuments()).toBe(1);
  });

  it("keeps concurrent issues consistent with committed movements", async () => {
    const stock = await createStock(10, "CONCURRENT-ISSUE");

    const results = await Promise.allSettled([
      inventoryService.createGoodsIssue({
        stockId: stock._id.toString(),
        quantity: 7,
        reference: "SO-CONCURRENT-001",
      }),
      inventoryService.createGoodsIssue({
        stockId: stock._id.toString(),
        quantity: 7,
        reference: "SO-CONCURRENT-002",
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      code: errorCodes.INSUFFICIENT_STOCK,
      httpStatus: 409,
      message: "Not enough stock available",
    });
    expect((await Stock.findById(stock._id)).quantity).toBe(3);
    expect(await StockMovement.countDocuments({ type: "GOODS_ISSUE" })).toBe(1);
  });
});
