const express = require("express");

const {
  createGoodsReceipt,
} = require("../controllers/goodsReceiptController");

const {
  createGoodsReceiptValidation,
} = require("../validators/goodsReceiptValidator");

const validateRequest = require("../middleware/validateRequest");

const {
  authenticateUser,
} = require("../middleware/authMiddleware");

const {
  authorizeRoles,
} = require("../middleware/roleMiddleware");

const router = express.Router();

router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createGoodsReceiptValidation,
  validateRequest,
  createGoodsReceipt
);

module.exports = router;