const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const withTransaction = require("../utils/transaction");

const createDomainError = (code, httpStatus, message) =>
  new DomainError({ code, httpStatus, message });

const validateSingleInventoryInput = ({ stockId, quantity }) => {
  if (!mongoose.Types.ObjectId.isValid(stockId)) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Invalid stock ID"
    );
  }

  if (!quantity || quantity <= 0) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Quantity must be greater than 0"
    );
  }
};

const createGoodsReceipt = async ({ stockId, quantity, reference, reason }) => {
  validateSingleInventoryInput({ stockId, quantity });

  return withTransaction(async (session) => {
    const updatedStock = await Stock.findOneAndUpdate(
      { _id: stockId, status: "active" },
      { $inc: { quantity } },
      { returnDocument: "after", session }
    );

    if (!updatedStock) {
      const stock = await Stock.findById(stockId).session(session);

      if (stock) {
        throw createDomainError(
          errorCodes.INACTIVE_STOCK,
          409,
          "Cannot receive goods into inactive stock"
        );
      }

      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "Stock record not found"
      );
    }

    const [stockMovement] = await StockMovement.create(
      [
        {
          stockId,
          type: "GOODS_RECEIPT",
          quantity,
          reference,
          reason,
        },
      ],
      { session }
    );

    return {
      stock: updatedStock,
      stockMovement,
    };
  });
};

const createGoodsIssue = async ({ stockId, quantity, reference, reason }) => {
  validateSingleInventoryInput({ stockId, quantity });

  return withTransaction(async (session) => {
    const updatedStock = await Stock.findOneAndUpdate(
      {
        _id: stockId,
        quantity: { $gte: quantity },
        status: "active",
      },
      { $inc: { quantity: -quantity } },
      { returnDocument: "after", session }
    );

    if (!updatedStock) {
      const stock = await Stock.findById(stockId).session(session);

      if (!stock) {
        throw createDomainError(
          errorCodes.RESOURCE_NOT_FOUND,
          404,
          "Stock record not found"
        );
      }

      if (stock.status !== "active") {
        throw createDomainError(
          errorCodes.INACTIVE_STOCK,
          409,
          "Cannot issue goods from inactive stock"
        );
      }

      throw createDomainError(
        errorCodes.INSUFFICIENT_STOCK,
        409,
        "Not enough stock available"
      );
    }

    const [stockMovement] = await StockMovement.create(
      [
        {
          stockId,
          type: "GOODS_ISSUE",
          quantity,
          reference,
          reason,
        },
      ],
      { session }
    );

    return {
      stock: updatedStock,
      stockMovement,
    };
  });
};

const createGoodsReceiptsBulk = async ({ receipts }) => {
  const quantityByStockId = new Map();

  for (const receipt of receipts) {
    const stockId = receipt.stockId.toLowerCase();
    const currentQuantity = quantityByStockId.get(stockId) || 0;
    quantityByStockId.set(stockId, currentQuantity + receipt.quantity);
  }

  const stockIds = [...quantityByStockId.keys()];

  return withTransaction(async (session) => {
    const stocks = await Stock.find({ _id: { $in: stockIds } }).session(session);

    if (stocks.length !== stockIds.length) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "One or more stock records were not found"
      );
    }

    if (stocks.some((stock) => stock.status !== "active")) {
      throw createDomainError(
        errorCodes.INACTIVE_STOCK,
        409,
        "Cannot receive goods into inactive stock"
      );
    }

    for (const [stockId, quantity] of quantityByStockId) {
      const updatedStock = await Stock.findOneAndUpdate(
        { _id: stockId, status: "active" },
        { $inc: { quantity } },
        { returnDocument: "after", session }
      );

      if (!updatedStock) {
        const stock = await Stock.findById(stockId).session(session);

        throw createDomainError(
          stock ? errorCodes.INACTIVE_STOCK : errorCodes.RESOURCE_NOT_FOUND,
          stock ? 409 : 404,
          stock
            ? "Cannot receive goods into inactive stock"
            : "One or more stock records were not found"
        );
      }
    }

    const stockMovements = await StockMovement.insertMany(
      receipts.map((receipt) => ({
        ...receipt,
        type: "GOODS_RECEIPT",
      })),
      { session }
    );
    const updatedStocks = await Stock.find({ _id: { $in: stockIds } }).session(
      session
    );

    return {
      processedCount: stockMovements.length,
      stockMovements,
      updatedStocks,
    };
  });
};

const createGoodsIssuesBulk = async ({ issues }) => {
  const quantityByStockId = new Map();

  for (const issue of issues) {
    const stockId = issue.stockId.toLowerCase();
    const currentQuantity = quantityByStockId.get(stockId) || 0;
    quantityByStockId.set(stockId, currentQuantity + issue.quantity);
  }

  const stockIds = [...quantityByStockId.keys()];

  return withTransaction(async (session) => {
    const stocks = await Stock.find({ _id: { $in: stockIds } }).session(session);

    if (stocks.length !== stockIds.length) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "One or more stock records were not found"
      );
    }

    if (stocks.some((stock) => stock.status !== "active")) {
      throw createDomainError(
        errorCodes.INACTIVE_STOCK,
        409,
        "Cannot issue goods from inactive stock"
      );
    }

    const stockById = new Map(
      stocks.map((stock) => [stock._id.toString(), stock])
    );
    const hasInsufficientStock = [...quantityByStockId].some(
      ([stockId, quantity]) => stockById.get(stockId).quantity < quantity
    );

    if (hasInsufficientStock) {
      throw createDomainError(
        errorCodes.INSUFFICIENT_STOCK,
        409,
        "Not enough stock available"
      );
    }

    for (const [stockId, quantity] of quantityByStockId) {
      const updatedStock = await Stock.findOneAndUpdate(
        { _id: stockId, quantity: { $gte: quantity }, status: "active" },
        { $inc: { quantity: -quantity } },
        { returnDocument: "after", session }
      );

      if (!updatedStock) {
        throw createDomainError(
          errorCodes.INSUFFICIENT_STOCK,
          409,
          "Not enough stock available"
        );
      }
    }

    const stockMovements = await StockMovement.insertMany(
      issues.map((issue) => ({
        ...issue,
        type: "GOODS_ISSUE",
      })),
      { session }
    );
    const updatedStocks = await Stock.find({ _id: { $in: stockIds } }).session(
      session
    );

    return {
      processedCount: stockMovements.length,
      stockMovements,
      updatedStocks,
    };
  });
};

module.exports = {
  createGoodsReceipt,
  createGoodsReceiptsBulk,
  createGoodsIssue,
  createGoodsIssuesBulk,
};
