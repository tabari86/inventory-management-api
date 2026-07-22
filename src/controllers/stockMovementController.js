const mongoose = require("mongoose");

const StockMovement = require("../models/StockMovement");

const getStockMovements = async (req, res, next) => {
  try {
    const stockMovements = await StockMovement.find()
      .populate("productId", "sku name unit status archivedAt")
      .populate("warehouseId", "code name status")
      .populate({
        path: "stockId",
        populate: [
          {
            path: "productId",
            select: "sku name unit status archivedAt",
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

    const stockMovement = await StockMovement.findById(id)
      .populate("productId", "sku name unit status archivedAt")
      .populate("warehouseId", "code name status")
      .populate({
        path: "stockId",
        populate: [
          {
            path: "productId",
            select: "sku name unit status archivedAt",
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
  getStockMovements,
  getStockMovementById,
};
