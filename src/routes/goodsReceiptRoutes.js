const express = require("express");

const {
  createGoodsReceipt,
  createGoodsReceiptsBulk,
} = require("../controllers/goodsReceiptController");

const {
  createGoodsReceiptValidation,
  createBulkGoodsReceiptValidation,
} = require("../validators/goodsReceiptValidator");

const validateRequest = require("../middleware/validateRequest");

const {
  authenticateUser,
} = require("../middleware/authMiddleware");

const {
  authorizeRoles,
} = require("../middleware/roleMiddleware");
const { bindInventoryOperation } = require("../middleware/inventoryIdempotency");
const { operations } = require("../services/inventoryOperationRegistry");

const router = express.Router();

/**
 * @swagger
 * /api/goods-receipts/bulk:
 *   post:
 *     summary: Receive multiple goods entries
 *     description: Processes between 1 and 150 goods receipts. Available to admin and manager roles.
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
 *                   example: 10
 *                 reference:
 *                   type: string
 *                   maxLength: 100
 *                   example: PO-BULK-001
 *                 reason:
 *                   type: string
 *                   maxLength: 500
 *                   example: Supplier delivery
 *     responses:
 *       201:
 *         description: Goods receipts completed successfully; response data includes processedCount, stockMovements, and updatedStocks
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkGoodsReceiptResponse'
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: One or more stock records were not found
 *       409:
 *         description: One or more Stock, Product, or Warehouse lifecycle checks reject the receipt
 *       500:
 *         description: Could not complete goods receipts
 */
router.post(
  "/bulk",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createBulkGoodsReceiptValidation,
  validateRequest,
  bindInventoryOperation(operations.GOODS_RECEIPT_BULK),
  createGoodsReceiptsBulk
);

/**
 * @swagger
 * /api/goods-receipts:
 *   post:
 *     summary: Receive goods and increase stock quantity
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
 *                 example: 10
 *               reference:
 *                 type: string
 *                 maxLength: 100
 *                 example: PO-1001
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 example: Supplier delivery
 *     responses:
 *       201:
 *         description: Goods receipt completed successfully
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Stock record not found
 *       409:
 *         description: Stock, Product, or Warehouse lifecycle checks reject the receipt
 *       500:
 *         description: Could not complete goods receipt
 */

router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createGoodsReceiptValidation,
  validateRequest,
  bindInventoryOperation(operations.GOODS_RECEIPT_SINGLE),
  createGoodsReceipt
);

module.exports = router;
