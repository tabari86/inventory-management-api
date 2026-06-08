const express = require("express");

const {
  createGoodsIssue,
} = require("../controllers/goodsIssueController");

const {
  createGoodsIssueValidation,
} = require("../validators/goodsIssueValidator");

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
  createGoodsIssueValidation,
  validateRequest,
  createGoodsIssue
);

module.exports = router;