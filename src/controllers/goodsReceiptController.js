const inventoryService = require("../services/inventoryService");
const { sendInventoryMutation } = require("../services/idempotencyExecutor");
const { buildCanonicalCommand } = require("../utils/canonicalJson");

const normalizeReceipt = ({ stockId, quantity, reference, reason }) => ({
  stockId: String(stockId).toLowerCase(),
  quantity,
  reference,
  reason,
});

const commandFor = (req, normalizedBody) =>
  buildCanonicalCommand({
    operationId: req.inventoryOperation.operationId,
    pathParameters: {},
    semanticQueryParameters: {},
    normalizedBody,
  });

const createGoodsReceipt = async (req, res, next) => {
  try {
    const { stockId, quantity, reference, reason } = req.body;
    const input = { stockId, quantity, reference, reason };
    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, normalizeReceipt(input)),
      execute: ({ session, eventCollector }) =>
        inventoryService.createGoodsReceipt({
          ...input,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Goods receipt completed successfully",
        data,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not complete goods receipt";
    next(error);
  }
};

const createGoodsReceiptsBulk = async (req, res, next) => {
  try {
    const receipts = req.body;
    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, receipts.map(normalizeReceipt)),
      execute: ({ session, eventCollector }) =>
        inventoryService.createGoodsReceiptsBulk({
          receipts,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Goods receipts completed successfully",
        data,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not complete goods receipts";
    next(error);
  }
};

module.exports = {
  createGoodsReceipt,
  createGoodsReceiptsBulk,
};
