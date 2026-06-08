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


/**
 * @swagger
 * /api/goods-receipts:
 *   post:
 *     summary: Receive goods and increase stock quantity
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
 *                 example: 10
 *               reference:
 *                 type: string
 *                 example: PO-1001
 *               reason:
 *                 type: string
 *                 example: Supplier delivery
 *     responses:
 *       201:
 *         description: Goods receipt completed successfully
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: Access denied
 *       404:
 *         description: Stock record not found
 */

router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createGoodsReceiptValidation,
  validateRequest,
  createGoodsReceipt
);

module.exports = router;