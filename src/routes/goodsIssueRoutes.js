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

/**
 * @swagger
 * /api/goods-issues/bulk:
 *   post:
 *     summary: Issue multiple goods entries
 *     description: Processes between 1 and 150 goods issues. Available to admin and manager roles.
 *     tags:
 *       - Inventory Workflows
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             minItems: 1
 *             maxItems: 150
 *             items:
 *               type: object
 *               required:
 *                 - stockId
 *                 - quantity
 *               properties:
 *                 stockId:
 *                   type: string
 *                   example: 6a2419ba74ab9f90ef69cb15
 *                 quantity:
 *                   type: integer
 *                   minimum: 1
 *                   example: 3
 *                 reference:
 *                   type: string
 *                   maxLength: 100
 *                   example: SO-BULK-001
 *                 reason:
 *                   type: string
 *                   maxLength: 500
 *                   example: Customer order
 *     responses:
 *       201:
 *         description: Goods issues completed successfully; response data includes processedCount, stockMovements, and updatedStocks
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkGoodsIssueResponse'
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: One or more stock records were not found
 *       409:
 *         description: Not enough stock is available or a stock record is inactive
 *       500:
 *         description: Could not complete goods issues
 */
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
 *     description: Available to admin and manager roles.
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
 *                 type: integer
 *                 minimum: 1
 *                 example: 3
 *               reference:
 *                 type: string
 *                 maxLength: 100
 *                 example: SO-1001
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 example: Customer order
 *     responses:
 *       201:
 *         description: Goods issue completed successfully
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Stock record not found
 *       409:
 *         description: Not enough stock is available or the stock record is inactive
 *       500:
 *         description: Could not complete goods issue
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
