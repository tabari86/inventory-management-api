const express = require("express");
const {
  createWarehouseValidation,
  updateWarehouseValidation,
  createBulkWarehousesValidation,
  updateBulkWarehousesValidation,
} = require("../validators/warehouseValidator");

const validateRequest = require("../middleware/validateRequest");

const {
  createWarehouse,
  createWarehousesBulk,
  updateWarehousesBulk,
  getWarehouses,
  getWarehouseById,
  updateWarehouse,
  deactivateWarehouse,
} = require("../controllers/warehouseController");
const { authenticateUser } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

const router = express.Router();



/**
 * @swagger
 * /api/warehouses:
 *   get:
 *     summary: Retrieve all warehouses
 *     tags:
 *       - Warehouses
 *     responses:
 *       200:
 *         description: Warehouses retrieved successfully
 *       500:
 *         description: Could not retrieve warehouses
 */
router.get(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager", "viewer"),
  getWarehouses
);

router.post(
  "/bulk",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createBulkWarehousesValidation,
  validateRequest,
  createWarehousesBulk
);

router.patch(
  "/bulk",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  updateBulkWarehousesValidation,
  validateRequest,
  updateWarehousesBulk
);




/**
 * @swagger
 * /api/warehouses/{id}:
 *   get:
 *     summary: Retrieve a single warehouse
 *     tags:
 *       - Warehouses
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Warehouse ID
 *     responses:
 *       200:
 *         description: Warehouse retrieved successfully
 *       400:
 *         description: Invalid warehouse ID
 *       404:
 *         description: Warehouse not found
 */
router.get(
  "/:id",
  authenticateUser,
  authorizeRoles("admin", "manager", "viewer"),
  getWarehouseById
);




/**
 * @swagger
 * /api/warehouses:
 *   post:
 *     summary: Create a new warehouse
 *     tags:
 *       - Warehouses
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - name
 *             properties:
 *               code:
 *                 type: string
 *                 example: WH-STU
 *               name:
 *                 type: string
 *                 example: Main Warehouse
 *               description:
 *                 type: string
 *                 example: Primary warehouse for incoming and outgoing goods
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *                 example: active
 *     responses:
 *       201:
 *         description: Warehouse created successfully
 *       400:
 *         description: Validation failed
 *       409:
 *         description: Warehouse with this code already exists
 *       500:
 *         description: Could not create warehouse
 */
router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createWarehouseValidation,
  validateRequest,
  createWarehouse
);



/**
 * @swagger
 * /api/warehouses/{id}:
 *   patch:
 *     summary: Update warehouse information
 *     tags:
 *       - Warehouses
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Warehouse ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Main Warehouse Germany
 *               description:
 *                 type: string
 *                 example: Updated warehouse description
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *                 example: active
 *     responses:
 *       200:
 *         description: Warehouse updated successfully
 *       400:
 *         description: Invalid warehouse ID
 *       404:
 *         description: Warehouse not found
 *       500:
 *         description: Could not update warehouse
 */
router.patch(
  "/:id",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  updateWarehouseValidation,
  validateRequest,
  updateWarehouse
);



/**
 * @swagger
 * /api/warehouses/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a warehouse
 *     tags:
 *       - Warehouses
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Warehouse ID
 *     responses:
 *       200:
 *         description: Warehouse deactivated successfully
 *       400:
 *         description: Invalid warehouse ID
 *       404:
 *         description: Warehouse not found
 *       500:
 *         description: Could not deactivate warehouse
 */
router.patch(
  "/:id/deactivate",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  deactivateWarehouse
);

module.exports = router;
