const inventoryService = require("../services/inventoryService");
const { sendInventoryMutation } = require("../services/idempotencyExecutor");
const { buildCanonicalCommand } = require("../utils/canonicalJson");

const normalizeIssue = ({ stockId, quantity, reference, reason }) => ({
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

const createGoodsIssue = async (req, res, next) => {
  try {
    const { stockId, quantity, reference, reason } = req.body;
    const input = { stockId, quantity, reference, reason };
    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, normalizeIssue(input)),
      execute: ({ session }) =>
        inventoryService.createGoodsIssue({
          ...input,
          session,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Goods issue completed successfully",
        data,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not complete goods issue";
    next(error);
  }
};

const createGoodsIssuesBulk = async (req, res, next) => {
  try {
    const issues = req.body;
    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, issues.map(normalizeIssue)),
      execute: ({ session }) =>
        inventoryService.createGoodsIssuesBulk({
          issues,
          session,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Goods issues completed successfully",
        data,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not complete goods issues";
    next(error);
  }
};

module.exports = {
  createGoodsIssue,
  createGoodsIssuesBulk,
};
