const express = require("express");

const {
  createGoodsReceipt,
} = require("../controllers/goodsReceiptController");

const {
  createGoodsReceiptValidation,
} = require("../validators/goodsReceiptValidator");

const validateRequest = require("../middleware/validateRequest");

const router = express.Router();

router.post(
  "/",
  createGoodsReceiptValidation,
  validateRequest,
  createGoodsReceipt
);

module.exports = router;