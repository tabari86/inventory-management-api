const inventoryService = require("../services/inventoryService");

const createGoodsIssue = async (req, res, next) => {
  try {
    const { stockId, quantity, reference, reason } = req.body;
    const data = await inventoryService.createGoodsIssue({
      stockId,
      quantity,
      reference,
      reason,
    });

    return res.status(201).json({
      message: "Goods issue completed successfully",
      data,
    });
  } catch (error) {
    error.clientMessage = "Could not complete goods issue";
    next(error);
  }
};

const createGoodsIssuesBulk = async (req, res, next) => {
  try {
    const data = await inventoryService.createGoodsIssuesBulk({
      issues: req.body,
    });

    return res.status(201).json({
      message: "Goods issues completed successfully",
      data,
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
