const express = require("express");

const {
  getStockMovements,
  getStockMovementById,
} = require("../controllers/stockMovementController");
const { authenticateUser } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

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
router.get(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager", "viewer"),
  getStockMovements
);



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
router.get(
  "/:id",
  authenticateUser,
  authorizeRoles("admin", "manager", "viewer"),
  getStockMovementById
);



module.exports = router;
