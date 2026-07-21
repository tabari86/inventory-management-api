const inventoryService = require("../services/inventoryService");

const createGoodsReceipt = async (req, res, next) => {
  try {
    const { stockId, quantity, reference, reason } = req.body;
    const data = await inventoryService.createGoodsReceipt({
      stockId,
      quantity,
      reference,
      reason,
    });

    return res.status(201).json({
      message: "Goods receipt completed successfully",
      data,
    });
  } catch (error) {
    error.clientMessage = "Could not complete goods receipt";
    next(error);
  }
};

const createGoodsReceiptsBulk = async (req, res, next) => {
  try {
    const data = await inventoryService.createGoodsReceiptsBulk({
      receipts: req.body,
    });

    return res.status(201).json({
      message: "Goods receipts completed successfully",
      data,
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
