const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const mongoose = require("mongoose");

const createGoodsReceipt = async (req, res, next) => {
  let stockWasIncremented = false;

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
      { _id: stockId, status: "active" },
      { $inc: { quantity } },
      { returnDocument: "after" }
    );

    if (!updatedStock) {
      const stock = await Stock.findById(stockId);

      if (stock) {
        return res.status(409).json({
          message: "Cannot receive goods into inactive stock",
        });
      }

      return res.status(404).json({
        message: "Stock record not found",
      });
    }

    stockWasIncremented = true;

    const stockMovement = await StockMovement.create({
      stockId,
      type: "GOODS_RECEIPT",
      quantity,
      reference,
      reason,
    });

    return res.status(201).json({
      message: "Goods receipt completed successfully",
      data: {
        stock: updatedStock,
        stockMovement,
      },
    });
  } catch (error) {
    if (stockWasIncremented) {
      try {
        await Stock.updateOne(
          { _id: req.body.stockId, quantity: { $gte: req.body.quantity } },
          { $inc: { quantity: -req.body.quantity } }
        );
      } catch (rollbackError) {
        console.error(
          `Could not roll back goods receipt stock update: ${rollbackError.message}`
        );
      }
    }

    error.message = "Could not complete goods receipt";
    next(error);
  }
};

const createGoodsReceiptsBulk = async (req, res, next) => {
  const updatedStockTotals = [];
  let createdMovementIds = [];

  try {
    const receipts = req.body;
    const quantityByStockId = new Map();

    for (const receipt of receipts) {
      const stockId = receipt.stockId.toLowerCase();
      const currentQuantity = quantityByStockId.get(stockId) || 0;
      quantityByStockId.set(stockId, currentQuantity + receipt.quantity);
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
        message: "Cannot receive goods into inactive stock",
      });
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

        return res.status(stock ? 409 : 404).json({
          message: stock
            ? "Cannot receive goods into inactive stock"
            : "One or more stock records were not found",
        });
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

    return res.status(201).json({
      message: "Goods receipts completed successfully",
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

    error.message = "Could not complete goods receipts";
    next(error);
  }
};

module.exports = {
  createGoodsReceipt,
  createGoodsReceiptsBulk,
};
