const express = require("express");

const {
  createGoodsIssue,
  createGoodsIssuesBulk,
} = require("../controllers/goodsIssueController");

const {
  createGoodsIssueValidation,
  createBulkGoodsIssueValidation,
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
  "/bulk",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createBulkGoodsIssueValidation,
  validateRequest,
  createGoodsIssuesBulk
);



/**
 * @swagger
 * /api/goods-issues:
 *   post:
 *     summary: Issue goods and decrease stock quantity
 *     tags:
 *       - Inventory Workflows
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stockId
 *               - quantity
 *             properties:
 *               stockId:
 *                 type: string
 *                 example: 6a2419ba74ab9f90ef69cb15
 *               quantity:
 *                 type: number
 *                 example: 3
 *               reference:
 *                 type: string
 *                 example: SO-1001
 *               reason:
 *                 type: string
 *                 example: Customer order
 *     responses:
 *       201:
 *         description: Goods issue completed successfully
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: Access denied
 *       404:
 *         description: Stock record not found
 *       409:
 *         description: Not enough stock available
 */


router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createGoodsIssueValidation,
  validateRequest,
  createGoodsIssue
);

module.exports = router;
