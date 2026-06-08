const express = require("express");

const {
  createStock,
  getStocks,
  getStockById,
} = require("../controllers/stockController");

const {
  createStockValidation,
} = require("../validators/stockValidator");

const validateRequest = require("../middleware/validateRequest");

const router = express.Router();


/**
 * @swagger
 * /api/stocks:
 *   get:
 *     summary: Retrieve all stock records
 *     tags:
 *       - Stocks
 *     responses:
 *       200:
 *         description: Stock records retrieved successfully
 *       500:
 *         description: Could not retrieve stock records
 */
router.get("/", getStocks);


/**
 * @swagger
 * /api/stocks/{id}:
 *   get:
 *     summary: Retrieve a single stock record
 *     tags:
 *       - Stocks
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Stock record ID
 *     responses:
 *       200:
 *         description: Stock record retrieved successfully
 *       400:
 *         description: Invalid stock ID
 *       404:
 *         description: Stock record not found
 */
router.get("/:id", getStockById);


/**
 * @swagger
 * /api/stocks:
 *   post:
 *     summary: Create a stock record for a product and warehouse
 *     tags:
 *       - Stocks
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *               - warehouseId
 *             properties:
 *               productId:
 *                 type: string
 *                 example: 6a24186174ab9f90ef69cb14
 *               warehouseId:
 *                 type: string
 *                 example: 6a23ebc39ca1ca27984458d2
 *     responses:
 *       201:
 *         description: Stock record created successfully
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Product or warehouse not found
 *       409:
 *         description: Stock record already exists or product/warehouse is inactive
 *       500:
 *         description: Could not create stock record
 */
router.post(
  "/",
  createStockValidation,
  validateRequest,
  createStock
);

module.exports = router;