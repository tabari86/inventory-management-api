const express = require("express");

const {
  createGoodsReceipt,
} = require("../controllers/goodsReceiptController");

const router = express.Router();

router.post("/", createGoodsReceipt);

module.exports = router;