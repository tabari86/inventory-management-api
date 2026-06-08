const mongoose = require("mongoose");

const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");

const createStockMovement = async (req, res, next) => {
  try {
    const { stockId, type, quantity, reference, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(stockId)) {
      return res.status(400).json({
        message: "Invalid stock ID",
      });
    }

    if (!type || !quantity) {
      return res.status(400).json({
        message: "Movement type and quantity are required",
      });
    }

    if (quantity <= 0) {
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
      type,
      quantity,
      reference,
      reason,
    });

    return res.status(201).json({
      message: "Stock movement created successfully",
      data: stockMovement,
    });
  } catch (error) {
    error.message = "Could not create stock movement";
    next(error);
  }
};

const getStockMovements = async (req, res, next) => {
  try {
    const stockMovements = await StockMovement.find()
      .populate({
        path: "stockId",
        populate: [
          {
            path: "productId",
            select: "sku name unit status",
          },
          {
            path: "warehouseId",
            select: "code name status",
          },
        ],
      })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      message: "Stock movements retrieved successfully",
      data: stockMovements,
    });
  } catch (error) {
    error.message = "Could not retrieve stock movements";
    next(error);
  }
};

const getStockMovementById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid stock movement ID",
      });
    }

    const stockMovement = await StockMovement.findById(id).populate({
      path: "stockId",
      populate: [
        {
          path: "productId",
          select: "sku name unit status",
        },
        {
          path: "warehouseId",
          select: "code name status",
        },
      ],
    });

    if (!stockMovement) {
      return res.status(404).json({
        message: "Stock movement not found",
      });
    }

    return res.status(200).json({
      message: "Stock movement retrieved successfully",
      data: stockMovement,
    });
  } catch (error) {
    error.message = "Could not retrieve stock movement";
    next(error);
  }
};

module.exports = {
  createStockMovement,
  getStockMovements,
  getStockMovementById,
};