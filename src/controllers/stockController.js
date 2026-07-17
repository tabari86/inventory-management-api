const mongoose = require("mongoose");

const Product = require("../models/Product");
const Warehouse = require("../models/Warehouse");
const Stock = require("../models/Stock");

const createStock = async (req, res, next) => {
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
    error.message = "Could not create stock record";
    next(error);
  }
};

const createStocksBulk = async (req, res, next) => {
  try {
    const stocksToCreate = req.body;
    const combinations = stocksToCreate.map(
      (stock) =>
        `${stock.productId.toLowerCase()}:${stock.warehouseId.toLowerCase()}`
    );

    if (new Set(combinations).size !== combinations.length) {
      return res.status(400).json({
        message: "Duplicate product and warehouse combinations are not allowed",
      });
    }

    const productIds = [
      ...new Set(stocksToCreate.map((stock) => stock.productId.toLowerCase())),
    ];
    const warehouseIds = [
      ...new Set(
        stocksToCreate.map((stock) => stock.warehouseId.toLowerCase())
      ),
    ];
    const [products, warehouses] = await Promise.all([
      Product.find({ _id: { $in: productIds } }),
      Warehouse.find({ _id: { $in: warehouseIds } }),
    ]);

    if (products.length !== productIds.length) {
      return res.status(404).json({
        message: "One or more products were not found",
      });
    }

    if (products.some((product) => product.status !== "active")) {
      return res.status(409).json({
        message: "Cannot create stock for inactive products",
      });
    }

    if (warehouses.length !== warehouseIds.length) {
      return res.status(404).json({
        message: "One or more warehouses were not found",
      });
    }

    if (warehouses.some((warehouse) => warehouse.status !== "active")) {
      return res.status(409).json({
        message: "Cannot create stock for inactive warehouses",
      });
    }

    const existingStock = await Stock.findOne({
      $or: stocksToCreate.map(({ productId, warehouseId }) => ({
        productId,
        warehouseId,
      })),
    });

    if (existingStock) {
      return res.status(409).json({
        message: "One or more stock records already exist",
      });
    }

    const stocks = await Stock.insertMany(
      stocksToCreate.map((stock) => ({ ...stock, quantity: 0 }))
    );

    return res.status(201).json({
      message: "Stock records created successfully",
      data: {
        createdCount: stocks.length,
        stocks,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "One or more stock records already exist",
      });
    }

    error.message = "Could not create stock records";
    next(error);
  }
};

const getStocks = async (req, res, next) => {
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
