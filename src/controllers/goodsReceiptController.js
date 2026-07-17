const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const mongoose = require("mongoose");

const createGoodsReceipt = async (req, res, next) => {
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

    const stock = await Stock.findById(stockId);

    if (!stock) {
      return res.status(404).json({
        message: "Stock record not found",
      });
    }

    const stockMovement = await StockMovement.create({
      stockId,
      type: "GOODS_RECEIPT",
      quantity,
      reference,
      reason,
    });

    stock.quantity += quantity;

    const updatedStock = await stock.save();

    return res.status(201).json({
      message: "Goods receipt completed successfully",
      data: {
        stock: updatedStock,
        stockMovement,
      },
    });
  } catch (error) {
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

    for (const [stockId, quantity] of quantityByStockId) {
      await Stock.updateOne({ _id: stockId }, { $inc: { quantity } });
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
      await StockMovement.deleteMany({ _id: { $in: createdMovementIds } });
    }

    if (updatedStockTotals.length > 0) {
      await Promise.all(
        updatedStockTotals.map(({ stockId, quantity }) =>
          Stock.updateOne({ _id: stockId }, { $inc: { quantity: -quantity } })
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
