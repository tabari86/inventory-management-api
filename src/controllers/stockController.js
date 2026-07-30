const sendInventoryMutation = require("../http/sendInventoryMutation");
const stockService = require("../services/stockService");
const { buildCanonicalCommand } = require("../utils/canonicalJson");
const readService = require("../services/readService");
const errorCodes = require("../errors/errorCodes");
const { sendError, sendPaginatedResult, sendSuccess } = require("../http/contract");
const {
  presentStock,
  presentStockBulkResult,
} = require("../http/resourcePresenters");

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
      execute: ({ session, eventCollector }) =>
        stockService.createStock({
          productId,
          warehouseId,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (stock) => ({
        message: "Stock record created successfully",
        data: stock,
      }),
      presentV1Data: presentStock,
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
      execute: ({ session, eventCollector }) =>
        stockService.createStocksBulk({
          stocks: req.body,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Stock records created successfully",
        data,
      }),
      presentV1Data: presentStockBulkResult,
    });
  } catch (error) {
    error.clientMessage = "Could not create stock records";
    next(error);
  }
};

const getStocks = async (req, res, next) => {
  try {
    const page = await readService.listStocks(req.query);
    return sendPaginatedResult(req, res, {
      statusCode: 200,
      message: "Stock records retrieved successfully",
      ...page,
    });
  } catch (error) {
    error.message = "Could not retrieve stock records";
    next(error);
  }
};

const getStockById = async (req, res, next) => {
  try {
    const stock = await readService.getStockById(req.params.id);

    if (!stock) {
      return sendError(req, res, {
        statusCode: 404,
        code: errorCodes.RESOURCE_NOT_FOUND,
        detail: "Stock record not found",
      });
    }

    return sendSuccess(req, res, {
      statusCode: 200,
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
