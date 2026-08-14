const express = require("express");
const {
  createWarehouseValidation,
  updateWarehouseValidation,
  createBulkWarehousesValidation,
  updateBulkWarehousesValidation,
  deactivateWarehouseValidation,
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
const { bindInventoryOperation } = require("../middleware/inventoryIdempotency");
const { operations } = require("../services/inventoryOperationRegistry");

const router = express.Router();

/**
 * @swagger
 * /api/warehouses:
 *   get:
 *     summary: Retrieve all warehouses
 *     description: Available to admin, manager, and viewer roles.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Warehouses retrieved successfully
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       500:
 *         description: Could not retrieve warehouses
 */
router.get(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager", "viewer"),
  getWarehouses
);

/**
 * @swagger
 * /api/warehouses/bulk:
 *   post:
 *     summary: Create multiple warehouses
 *     description: Creates between 1 and 150 warehouses. Available to admin and manager roles.
 *     tags:
 *       - Warehouses
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
 *                 - code
 *                 - name
 *               properties:
 *                 code:
 *                   type: string
 *                   maxLength: 64
 *                   pattern: '^[A-Z0-9_-]+$'
 *                   example: WH-BULK-001
 *                 name:
 *                   type: string
 *                   maxLength: 120
 *                   example: Bulk Warehouse One
 *                 description:
 *                   type: string
 *                   maxLength: 500
 *                   example: Warehouse created in a bulk request
 *                 status:
 *                   type: string
 *                   enum: [active, inactive]
 *                   example: active
 *     responses:
 *       201:
 *         description: Warehouses created successfully; response data includes createdCount and warehouses
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkWarehousesResponse'
 *       400:
 *         description: Validation failed or duplicate warehouse codes were provided in the request
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       409:
 *         description: One or more warehouse codes already exist
 *       500:
 *         description: Could not create warehouses
 */
router.post(
  "/bulk",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createBulkWarehousesValidation,
  validateRequest,
  bindInventoryOperation(operations.WAREHOUSE_BULK_CREATE),
  createWarehousesBulk
);

/**
 * @swagger
 * /api/warehouses/bulk:
 *   patch:
 *     summary: Update multiple warehouses
 *     description: Updates between 1 and 150 warehouses. Each item requires an ID, its current expectedVersion, and at least one of name, description, or status; warehouse codes cannot be changed. Available to admin and manager roles.
 *     tags:
 *       - Warehouses
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
 *               minProperties: 2
 *               required:
 *                 - id
 *                 - expectedVersion
 *               properties:
 *                 id:
 *                   type: string
 *                   example: 6a23ebc39ca1ca27984458d2
 *                 name:
 *                   type: string
 *                   maxLength: 120
 *                   example: Updated Warehouse
 *                 description:
 *                   type: string
 *                   maxLength: 500
 *                   example: Updated warehouse description
 *                 status:
 *                   type: string
 *                   enum: [active, inactive]
 *                   example: inactive
 *                 expectedVersion:
 *                   type: integer
 *                   minimum: 1
 *                   description: Required optimistic-concurrency precondition
 *                 deactivationReason:
 *                   type: string
 *                   maxLength: 500
 *     responses:
 *       200:
 *         description: Warehouses updated successfully; response data includes updatedCount and warehouses
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkWarehousesResponse'
 *       400:
 *         description: Validation failed or duplicate warehouse IDs were provided
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: One or more warehouses were not found
 *       409:
 *         description: An expected version is stale
 *       500:
 *         description: Could not update warehouses
 */
router.patch(
  "/bulk",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  updateBulkWarehousesValidation,
  validateRequest,
  bindInventoryOperation(operations.WAREHOUSE_BULK_UPDATE),
  updateWarehousesBulk
);

/**
 * @swagger
 * /api/warehouses/{id}:
 *   get:
 *     summary: Retrieve a single warehouse
 *     description: Available to admin, manager, and viewer roles.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
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
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Warehouse not found
 *       500:
 *         description: Could not retrieve warehouse
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
 *     description: Available to admin and manager roles.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
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
 *                 maxLength: 64
 *                 pattern: '^[A-Z0-9_-]+$'
 *                 example: WH-STU
 *               name:
 *                 type: string
 *                 maxLength: 120
 *                 example: Main Warehouse
 *               description:
 *                 type: string
 *                 maxLength: 500
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
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
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
  bindInventoryOperation(operations.WAREHOUSE_CREATE),
  createWarehouse
);

/**
 * @swagger
 * /api/warehouses/{id}:
 *   patch:
 *     summary: Update warehouse information
 *     description: Warehouse codes cannot be changed; at least one of name, description, or status is required. Available to admin and manager roles.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
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
 *             minProperties: 1
 *             required:
 *               - expectedVersion
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 120
 *                 example: Main Warehouse Germany
 *               description:
 *                 type: string
 *                 maxLength: 500
 *                 example: Updated warehouse description
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *                 example: active
 *               expectedVersion:
 *                 type: integer
 *                 minimum: 1
 *                 description: Required optimistic-concurrency precondition
 *               deactivationReason:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Warehouse updated successfully
 *       400:
 *         description: Validation failed, including a missing or invalid expectedVersion
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Warehouse not found
 *       409:
 *         description: Expected version is stale
 *       500:
 *         description: Could not update warehouse
 */
router.patch(
  "/:id",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  updateWarehouseValidation,
  validateRequest,
  bindInventoryOperation(operations.WAREHOUSE_UPDATE),
  updateWarehouse
);

/**
 * @swagger
 * /api/warehouses/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a warehouse
 *     description: Deactivates the Warehouse and propagates its Stock lifecycle guards atomically. Repeating an already-applied transition is a no-op. Available to admin and manager roles.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
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
 *             required:
 *               - expectedVersion
 *             properties:
 *               expectedVersion:
 *                 type: integer
 *                 minimum: 1
 *               deactivationReason:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Warehouse deactivated successfully
 *       400:
 *         description: Validation failed, including a missing or invalid expectedVersion
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Warehouse not found
 *       409:
 *         description: Expected version is stale
 *       500:
 *         description: Could not deactivate warehouse
 */
router.patch(
  "/:id/deactivate",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  deactivateWarehouseValidation,
  validateRequest,
  bindInventoryOperation(operations.WAREHOUSE_DEACTIVATE),
  deactivateWarehouse
);

module.exports = router;
