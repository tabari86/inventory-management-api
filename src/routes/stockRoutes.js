const express = require("express");

const {
  createStock,
  createStocksBulk,
  getStocks,
  getStockById,
} = require("../controllers/stockController");

const {
  createStockValidation,
  createBulkStocksValidation,
} = require("../validators/stockValidator");

const validateRequest = require("../middleware/validateRequest");
const { authenticateUser } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");
const { bindInventoryOperation } = require("../middleware/inventoryIdempotency");
const { operations } = require("../services/inventoryOperationRegistry");

const router = express.Router();

/**
 * @swagger
 * /api/stocks:
 *   get:
 *     summary: Retrieve all stock records
 *     description: Available to admin, manager, and viewer roles.
 *     tags:
 *       - Stocks
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stock records retrieved successfully
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       500:
 *         description: Could not retrieve stock records
 */
router.get(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager", "viewer"),
  getStocks
);

/**
 * @swagger
 * /api/stocks/bulk:
 *   post:
 *     summary: Create multiple stock records
 *     description: Creates between 1 and 150 stock records with an initial quantity of zero. Available to admin and manager roles.
 *     tags:
 *       - Stocks
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
 *                 - productId
 *                 - warehouseId
 *               properties:
 *                 productId:
 *                   type: string
 *                   example: 6a24186174ab9f90ef69cb14
 *                 warehouseId:
 *                   type: string
 *                   example: 6a23ebc39ca1ca27984458d2
 *     responses:
 *       201:
 *         description: Stock records created successfully; response data includes createdCount and stocks
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkStocksResponse'
 *       400:
 *         description: Validation failed or duplicate product and warehouse combinations were provided
 *         x-error-codes:
 *           - VALIDATION_FAILED
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: One or more products or warehouses were not found
 *       409:
 *         description: A stock record already exists, a parent is inactive/archived, or a parent version conflicts
 *         x-error-codes:
 *           - DUPLICATE_RESOURCE
 *           - INACTIVE_PRODUCT
 *           - INACTIVE_WAREHOUSE
 *           - STALE_VERSION
 *       500:
 *         description: Could not create stock records
 */
router.post(
  "/bulk",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createBulkStocksValidation,
  validateRequest,
  bindInventoryOperation(operations.STOCK_BULK_CREATE),
  createStocksBulk
);

/**
 * @swagger
 * /api/stocks/{id}:
 *   get:
 *     summary: Retrieve a single stock record
 *     description: Available to admin, manager, and viewer roles.
 *     tags:
 *       - Stocks
 *     security:
 *       - bearerAuth: []
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
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Stock record not found
 *       500:
 *         description: Could not retrieve stock record
 */
router.get(
  "/:id",
  authenticateUser,
  authorizeRoles("admin", "manager", "viewer"),
  getStockById
);

/**
 * @swagger
 * /api/stocks:
 *   post:
 *     summary: Create a stock record for a product and warehouse
 *     description: Creates a stock record with an initial quantity of zero. Available to admin and manager roles.
 *     tags:
 *       - Stocks
 *     security:
 *       - bearerAuth: []
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
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Product or warehouse not found
 *       409:
 *         description: Stock record already exists, a parent is inactive/archived, or a parent version conflicts
 *       500:
 *         description: Could not create stock record
 */
router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createStockValidation,
  validateRequest,
  bindInventoryOperation(operations.STOCK_CREATE),
  createStock
);

module.exports = router;
