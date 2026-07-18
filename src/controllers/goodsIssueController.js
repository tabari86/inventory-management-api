const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const mongoose = require("mongoose");

const createGoodsIssue = async (req, res, next) => {
  let stockWasDecremented = false;

  try {
    const { stockId, quantity, reference, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(stockId)) {
      return res.status(400).json({
        message: "Invalid stock ID",
      });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        message: "Quantity must be greater than 0",
      });
    }

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
        return res.status(404).json({
          message: "Stock record not found",
        });
      }

      return res.status(409).json({
        message:
          stock.status === "active"
            ? "Not enough stock available"
            : "Cannot issue goods from inactive stock",
      });
    }

    stockWasDecremented = true;

    const stockMovement = await StockMovement.create({
      stockId,
      type: "GOODS_ISSUE",
      quantity,
      reference,
      reason,
    });

    return res.status(201).json({
      message: "Goods issue completed successfully",
      data: {
        stock: updatedStock,
        stockMovement,
      },
    });
  } catch (error) {
    if (stockWasDecremented) {
      try {
        await Stock.updateOne(
          { _id: req.body.stockId },
          { $inc: { quantity: req.body.quantity } }
        );
      } catch (rollbackError) {
        console.error(
          `Could not roll back goods issue stock update: ${rollbackError.message}`
        );
      }
    }

    error.message = "Could not complete goods issue";
    next(error);
  }
};

const createGoodsIssuesBulk = async (req, res, next) => {
  const updatedStockTotals = [];
  let createdMovementIds = [];

  try {
    const issues = req.body;
    const quantityByStockId = new Map();

    for (const issue of issues) {
      const stockId = issue.stockId.toLowerCase();
      const currentQuantity = quantityByStockId.get(stockId) || 0;
      quantityByStockId.set(stockId, currentQuantity + issue.quantity);
    }

    const stockIds = [...quantityByStockId.keys()];
    const stocks = await Stock.find({ _id: { $in: stockIds } });

    if (stocks.length !== stockIds.length) {
      return res.status(404).json({
        message: "One or more stock records were not found",
      });
    }

    if (stocks.some((stock) => stock.status !== "active")) {
      return res.status(409).json({
        message: "Cannot issue goods from inactive stock",
      });
    }

    const stockById = new Map(
      stocks.map((stock) => [stock._id.toString(), stock])
    );
    const hasInsufficientStock = [...quantityByStockId].some(
      ([stockId, quantity]) => stockById.get(stockId).quantity < quantity
    );

    if (hasInsufficientStock) {
      return res.status(409).json({
        message: "Not enough stock available",
      });
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

        return res.status(409).json({
          message: "Not enough stock available",
        });
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

    return res.status(201).json({
      message: "Goods issues completed successfully",
      data: {
        processedCount: stockMovements.length,
        stockMovements,
        updatedStocks,
      },
    });
  } catch (error) {
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

    error.message = "Could not complete goods issues";
    next(error);
  }
};

module.exports = {
  createGoodsIssue,
  createGoodsIssuesBulk,
};
