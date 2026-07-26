const mongoose = require("mongoose");

const Stock = require("../models/Stock");
const { sendInventoryMutation } = require("../services/idempotencyExecutor");
const stockService = require("../services/stockService");
const { buildCanonicalCommand } = require("../utils/canonicalJson");

const normalizeId = (id) => String(id).toLowerCase();
const commandFor = (req, normalizedBody) =>
  buildCanonicalCommand({
    operationId: req.inventoryOperation.operationId,
    pathParameters: {},
    semanticQueryParameters: {},
    normalizedBody,
  });

const createStock = async (req, res, next) => {
  try {
    const { productId, warehouseId } = req.body;
    const input = {
      productId: normalizeId(productId),
      warehouseId: normalizeId(warehouseId),
    };
    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, input),
      execute: ({ session }) =>
        stockService.createStock({
          productId,
          warehouseId,
          session,
          context: req.applicationContext,
        }),
      buildResponse: (stock) => ({
        message: "Stock record created successfully",
        data: stock,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not create stock record";
    next(error);
  }
};

const createStocksBulk = async (req, res, next) => {
  try {
    const normalizedStocks = req.body.map(({ productId, warehouseId }) => ({
      productId: normalizeId(productId),
      warehouseId: normalizeId(warehouseId),
    }));
    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, normalizedStocks),
      execute: ({ session }) =>
        stockService.createStocksBulk({
          stocks: req.body,
          session,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Stock records created successfully",
        data,
      }),
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
