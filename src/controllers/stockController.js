const mongoose = require("mongoose");

const Product = require("../models/Product");
const Warehouse = require("../models/Warehouse");
const Stock = require("../models/Stock");

const createStock = async (req, res) => {
  try {
    const { productId, warehouseId } = req.body;

    if (
      !mongoose.Types.ObjectId.isValid(productId) ||
      !mongoose.Types.ObjectId.isValid(warehouseId)
    ) {
      return res.status(400).json({
        message: "Invalid product or warehouse ID",
      });
    }

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    if (product.status !== "active") {
      return res.status(409).json({
        message: "Cannot create stock for inactive product",
      });
    }

    const warehouse = await Warehouse.findById(warehouseId);

    if (!warehouse) {
      return res.status(404).json({
        message: "Warehouse not found",
      });
    }

    if (warehouse.status !== "active") {
      return res.status(409).json({
        message: "Cannot create stock for inactive warehouse",
      });
    }

    const existingStock = await Stock.findOne({
      productId,
      warehouseId,
    });

    if (existingStock) {
      return res.status(409).json({
        message: "Stock record already exists for this product and warehouse",
      });
    }

    const stock = await Stock.create({
      productId,
      warehouseId,
      quantity: 0,
    });

    return res.status(201).json({
      message: "Stock record created successfully",
      data: stock,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not create stock record",
    });
  }
};

const getStocks = async (req, res) => {
  try {
    const stocks = await Stock.find()
      .populate("productId", "sku name unit status")
      .populate("warehouseId", "code name status")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      message: "Stock records retrieved successfully",
      data: stocks,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not retrieve stock records",
    });
  }
};

const getStockById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid stock ID",
      });
    }

    const stock = await Stock.findById(id)
      .populate("productId", "sku name unit status")
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
    return res.status(500).json({
      message: "Could not retrieve stock record",
    });
  }
};

module.exports = {
  createStock,
  getStocks,
  getStockById,
};