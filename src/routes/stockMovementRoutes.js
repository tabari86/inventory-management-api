const express = require("express");

const {
  createStockMovement,
  getStockMovements,
  getStockMovementById,
} = require("../controllers/stockMovementController");

const router = express.Router();


/**
 * @swagger
 * /api/stock-movements:
 *   get:
 *     summary: Retrieve all stock movements
 *     tags:
 *       - Stock Movements
 *     responses:
 *       200:
 *         description: Stock movements retrieved successfully
 *       500:
 *         description: Could not retrieve stock movements
 */
router.get("/", getStockMovements);



/**
 * @swagger
 * /api/stock-movements/{id}:
 *   get:
 *     summary: Retrieve a single stock movement
 *     tags:
 *       - Stock Movements
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Stock movement ID
 *     responses:
 *       200:
 *         description: Stock movement retrieved successfully
 *       400:
 *         description: Invalid stock movement ID
 *       404:
 *         description: Stock movement not found
 *       500:
 *         description: Could not retrieve stock movement
 */
router.get("/:id", getStockMovementById);



/**
 * @swagger
 * /api/stock-movements:
 *   post:
 *     summary: Create a stock movement record
 *     tags:
 *       - Stock Movements
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stockId
 *               - type
 *               - quantity
 *             properties:
 *               stockId:
 *                 type: string
 *                 example: 6a2419ba74ab9f90ef69cb15
 *               type:
 *                 type: string
 *                 enum:
 *                   - GOODS_RECEIPT
 *                   - GOODS_ISSUE
 *                   - ADJUSTMENT
 *                   - TRANSFER_IN
 *                   - TRANSFER_OUT
 *                 example: GOODS_RECEIPT
 *               quantity:
 *                 type: number
 *                 example: 10
 *               reference:
 *                 type: string
 *                 example: PO-1001
 *               reason:
 *                 type: string
 *                 example: Initial stock movement
 *     responses:
 *       201:
 *         description: Stock movement created successfully
 *       400:
 *         description: Invalid request or validation failed
 *       404:
 *         description: Stock record not found
 *       500:
 *         description: Could not create stock movement
 */
router.post("/", createStockMovement);

module.exports = router;