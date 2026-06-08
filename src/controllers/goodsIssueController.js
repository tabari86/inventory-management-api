const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const mongoose = require("mongoose");

const createGoodsIssue = async (req, res, next) => {
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

    if (stock.quantity < quantity) {
      return res.status(409).json({
        message: "Not enough stock available",
      });
    }

    const stockMovement = await StockMovement.create({
      stockId,
      type: "GOODS_ISSUE",
      quantity,
      reference,
      reason,
    });

    stock.quantity -= quantity;

    const updatedStock = await stock.save();

    return res.status(201).json({
      message: "Goods issue completed successfully",
      data: {
        stock: updatedStock,
        stockMovement,
      },
    });
  } catch (error) {
    error.message = "Could not complete goods issue";
    next(error);
  }
};

module.exports = {
  createGoodsIssue,
};