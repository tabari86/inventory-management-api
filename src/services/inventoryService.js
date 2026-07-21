const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");

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
  let stockWasIncremented = false;

  try {
    validateSingleInventoryInput({ stockId, quantity });

    const updatedStock = await Stock.findOneAndUpdate(
      { _id: stockId, status: "active" },
      { $inc: { quantity } },
      { returnDocument: "after" }
    );

    if (!updatedStock) {
      const stock = await Stock.findById(stockId);

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

    stockWasIncremented = true;

    const stockMovement = await StockMovement.create({
      stockId,
      type: "GOODS_RECEIPT",
      quantity,
      reference,
      reason,
    });

    return {
      stock: updatedStock,
      stockMovement,
    };
  } catch (error) {
    if (stockWasIncremented) {
      try {
        await Stock.updateOne(
          { _id: stockId, quantity: { $gte: quantity } },
          { $inc: { quantity: -quantity } }
        );
      } catch (rollbackError) {
        console.error(
          `Could not roll back goods receipt stock update: ${rollbackError.message}`
        );
      }
    }

    throw error;
  }
};

const createGoodsIssue = async ({ stockId, quantity, reference, reason }) => {
  let stockWasDecremented = false;

  try {
    validateSingleInventoryInput({ stockId, quantity });

    const updatedStock = await Stock.findOneAndUpdate(
      {
        _id: stockId,
        quantity: { $gte: quantity },
        status: "active",
      },
      { $inc: { quantity: -quantity } },
      { returnDocument: "after" }
    );

    if (!updatedStock) {
      const stock = await Stock.findById(stockId);

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

    stockWasDecremented = true;

    const stockMovement = await StockMovement.create({
      stockId,
      type: "GOODS_ISSUE",
      quantity,
      reference,
      reason,
    });

    return {
      stock: updatedStock,
      stockMovement,
    };
  } catch (error) {
    if (stockWasDecremented) {
      try {
        await Stock.updateOne(
          { _id: stockId },
          { $inc: { quantity } }
        );
      } catch (rollbackError) {
        console.error(
          `Could not roll back goods issue stock update: ${rollbackError.message}`
        );
      }
    }

    throw error;
  }
};

const createGoodsReceiptsBulk = async ({ receipts }) => {
  const updatedStockTotals = [];
  let createdMovementIds = [];

  try {
    const quantityByStockId = new Map();

    for (const receipt of receipts) {
      const stockId = receipt.stockId.toLowerCase();
      const currentQuantity = quantityByStockId.get(stockId) || 0;
      quantityByStockId.set(stockId, currentQuantity + receipt.quantity);
    }

    const stockIds = [...quantityByStockId.keys()];
    const stocks = await Stock.find({ _id: { $in: stockIds } });

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
        { returnDocument: "after" }
      );

      if (!updatedStock) {
        const rollbackResults = await Promise.allSettled(
          updatedStockTotals.map((updated) =>
            Stock.updateOne(
              { _id: updated.stockId, quantity: { $gte: updated.quantity } },
              { $inc: { quantity: -updated.quantity } }
            )
          )
        );
        rollbackResults
          .filter((result) => result.status === "rejected")
          .forEach((result) =>
            console.error(
              `Could not roll back partial goods receipt stock update: ${result.reason.message}`
            )
          );
        updatedStockTotals.length = 0;

        const stock = await Stock.findById(stockId);

        throw createDomainError(
          stock ? errorCodes.INACTIVE_STOCK : errorCodes.RESOURCE_NOT_FOUND,
          stock ? 409 : 404,
          stock
            ? "Cannot receive goods into inactive stock"
            : "One or more stock records were not found"
        );
      }

      updatedStockTotals.push({ stockId, quantity });
    }

    const stockMovements = await StockMovement.insertMany(
      receipts.map((receipt) => ({
        ...receipt,
        type: "GOODS_RECEIPT",
      }))
    );
    createdMovementIds = stockMovements.map((movement) => movement._id);
    const updatedStocks = await Stock.find({ _id: { $in: stockIds } });

    return {
      processedCount: stockMovements.length,
      stockMovements,
      updatedStocks,
    };
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    if (createdMovementIds.length > 0) {
      try {
        await StockMovement.deleteMany({ _id: { $in: createdMovementIds } });
      } catch (rollbackError) {
        console.error(
          `Could not roll back goods receipt movements: ${rollbackError.message}`
        );
      }
    }

    if (updatedStockTotals.length > 0) {
      const rollbackResults = await Promise.allSettled(
        updatedStockTotals.map(({ stockId, quantity }) =>
          Stock.updateOne(
            { _id: stockId, quantity: { $gte: quantity } },
            { $inc: { quantity: -quantity } }
          )
        )
      );
      rollbackResults
        .filter((result) => result.status === "rejected")
        .forEach((result) =>
          console.error(
            `Could not roll back goods receipt stock update: ${result.reason.message}`
          )
        );
    }

    throw error;
  }
};

const createGoodsIssuesBulk = async ({ issues }) => {
  const updatedStockTotals = [];
  let createdMovementIds = [];

  try {
    const quantityByStockId = new Map();

    for (const issue of issues) {
      const stockId = issue.stockId.toLowerCase();
      const currentQuantity = quantityByStockId.get(stockId) || 0;
      quantityByStockId.set(stockId, currentQuantity + issue.quantity);
    }

    const stockIds = [...quantityByStockId.keys()];
    const stocks = await Stock.find({ _id: { $in: stockIds } });

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
        { returnDocument: "after" }
      );

      if (!updatedStock) {
        const rollbackResults = await Promise.allSettled(
          updatedStockTotals.map((updated) =>
            Stock.updateOne(
              { _id: updated.stockId },
              { $inc: { quantity: updated.quantity } }
            )
          )
        );
        rollbackResults
          .filter((result) => result.status === "rejected")
          .forEach((result) =>
            console.error(
              `Could not roll back partial goods issue stock update: ${result.reason.message}`
            )
          );
        updatedStockTotals.length = 0;

        throw createDomainError(
          errorCodes.INSUFFICIENT_STOCK,
          409,
          "Not enough stock available"
        );
      }

      updatedStockTotals.push({ stockId, quantity });
    }

    const stockMovements = await StockMovement.insertMany(
      issues.map((issue) => ({
        ...issue,
        type: "GOODS_ISSUE",
      }))
    );
    createdMovementIds = stockMovements.map((movement) => movement._id);
    const updatedStocks = await Stock.find({ _id: { $in: stockIds } });

    return {
      processedCount: stockMovements.length,
      stockMovements,
      updatedStocks,
    };
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    if (createdMovementIds.length > 0) {
      try {
        await StockMovement.deleteMany({ _id: { $in: createdMovementIds } });
      } catch (rollbackError) {
        console.error(
          `Could not roll back goods issue movements: ${rollbackError.message}`
        );
      }
    }

    if (updatedStockTotals.length > 0) {
      const rollbackResults = await Promise.allSettled(
        updatedStockTotals.map(({ stockId, quantity }) =>
          Stock.updateOne({ _id: stockId }, { $inc: { quantity } })
        )
      );
      rollbackResults
        .filter((result) => result.status === "rejected")
        .forEach((result) =>
          console.error(
            `Could not roll back goods issue stock update: ${result.reason.message}`
          )
        );
    }

    throw error;
  }
};

module.exports = {
  createGoodsReceipt,
  createGoodsReceiptsBulk,
  createGoodsIssue,
  createGoodsIssuesBulk,
};
