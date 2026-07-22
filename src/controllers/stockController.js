const mongoose = require("mongoose");

const Stock = require("../models/Stock");
const stockService = require("../services/stockService");

const createStock = async (req, res, next) => {
  try {
    const { productId, warehouseId } = req.body;
    const stock = await stockService.createStock({
      productId,
      warehouseId,
    });

    return res.status(201).json({
      message: "Stock record created successfully",
      data: stock,
    });
  } catch (error) {
    error.clientMessage = "Could not create stock record";
    next(error);
  }
};

const createStocksBulk = async (req, res, next) => {
  try {
    const data = await stockService.createStocksBulk({ stocks: req.body });

    return res.status(201).json({
      message: "Stock records created successfully",
      data,
    });
  } catch (error) {
    error.clientMessage = "Could not create stock records";
    next(error);
  }
};

const getStocks = async (req, res, next) => {
  try {
    const stocks = await Stock.find()
      .populate("productId", "sku name unit status archivedAt")
      .populate("warehouseId", "code name status")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      message: "Stock records retrieved successfully",
      data: stocks,
    });
  } catch (error) {
    error.message = "Could not retrieve stock records";
    next(error);
  }
};

const getStockById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid stock ID",
      });
    }

    const stock = await Stock.findById(id)
      .populate("productId", "sku name unit status archivedAt")
      .populate("warehouseId", "code name status");

    if (!stock) {
      return res.status(404).json({
        message: "Stock record not found",
      });
    }

    return res.status(200).json({
      message: "Stock record retrieved successfully",
      data: stock,
    });
  } catch (error) {
    error.message = "Could not retrieve stock record";
    next(error);
  }
};

module.exports = {
  createStock,
  createStocksBulk,
  getStocks,
  getStockById,
};
