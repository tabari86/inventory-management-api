const express = require("express");

const {
  createGoodsIssue,
} = require("../controllers/goodsIssueController");

const {
  createGoodsIssueValidation,
} = require("../validators/goodsIssueValidator");

const validateRequest = require("../middleware/validateRequest");

const router = express.Router();

router.post(
  "/",
  createGoodsIssueValidation,
  validateRequest,
  createGoodsIssue
);

module.exports = router;