const express = require("express");
const {
  createProductValidation,
  updateProductValidation,
  createBulkProductsValidation,
  updateBulkProductsValidation,
  deleteBulkProductsValidation,
  deactivateProductValidation,
  archiveProductValidation,
} = require("../validators/productValidator");

const validateRequest = require("../middleware/validateRequest");

const {
  createProduct,
  createProductsBulk,
  updateProductsBulk,
  deleteProductsBulk,
  getProducts,
  getProductById,
  updateProduct,
  deactivateProduct,
  deleteProduct,
} = require("../controllers/productController");
const { authenticateUser } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");
const { bindInventoryOperation } = require("../middleware/inventoryIdempotency");
const { operations } = require("../services/inventoryOperationRegistry");

const router = express.Router();

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Retrieve all products
 *     description: Available to admin, manager, and viewer roles.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       500:
 *         description: Could not retrieve products
 */
router.get(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager", "viewer"),
  getProducts
);

/**
 * @swagger
 * /api/products/bulk:
 *   post:
 *     summary: Create multiple products
 *     description: Creates between 1 and 150 products. Available to admin and manager roles.
 *     tags:
 *       - Products
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
 *                 - sku
 *                 - name
 *               properties:
 *                 sku:
 *                   type: string
 *                   maxLength: 64
 *                   pattern: '^[A-Z0-9_-]+$'
 *                   example: BULK-001
 *                 name:
 *                   type: string
 *                   maxLength: 120
 *                   example: Bulk Product One
 *                 description:
 *                   type: string
 *                   maxLength: 500
 *                   example: Product created in a bulk request
 *                 unit:
 *                   type: string
 *                   enum: [piece, kg, liter, meter]
 *                   example: piece
 *                 status:
 *                   type: string
 *                   enum: [active, inactive]
 *                   example: active
 *     responses:
 *       201:
 *         description: Products created successfully; response data includes createdCount and products
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkProductsResponse'
 *       400:
 *         description: Validation failed or duplicate SKUs were provided in the request
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       409:
 *         description: One or more product SKUs already exist
 *       500:
 *         description: Could not create products
 */
router.post(
  "/bulk",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createBulkProductsValidation,
  validateRequest,
  bindInventoryOperation(operations.PRODUCT_BULK_CREATE),
  createProductsBulk
);

/**
 * @swagger
 * /api/products/bulk:
 *   patch:
 *     summary: Update multiple products
 *     description: Updates between 1 and 150 products. Each item requires an ID and at least one updatable product field. Available to admin and manager roles.
 *     tags:
 *       - Products
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
 *               properties:
 *                 id:
 *                   type: string
 *                   example: 6a24186174ab9f90ef69cb14
 *                 sku:
 *                   type: string
 *                   maxLength: 64
 *                   pattern: '^[A-Z0-9_-]+$'
 *                   example: BULK-001-UPDATED
 *                 name:
 *                   type: string
 *                   maxLength: 120
 *                   example: Updated Bulk Product
 *                 description:
 *                   type: string
 *                   maxLength: 500
 *                   example: Updated product description
 *                 unit:
 *                   type: string
 *                   enum: [piece, kg, liter, meter]
 *                   example: piece
 *                 status:
 *                   type: string
 *                   enum: [active, inactive]
 *                   example: inactive
 *                 expectedVersion:
 *                   type: integer
 *                   minimum: 1
 *                   description: Optional transitional optimistic-concurrency precondition
 *                 deactivationReason:
 *                   type: string
 *                   maxLength: 500
 *     responses:
 *       200:
 *         description: Products updated successfully; response data includes updatedCount and products
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkProductsResponse'
 *       400:
 *         description: Validation failed or duplicate product IDs or SKUs were provided
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: One or more products were not found
 *       409:
 *         description: One or more product SKUs already exist or an expected version is stale
 *       500:
 *         description: Could not update products
 */
router.patch(
  "/bulk",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  updateBulkProductsValidation,
  validateRequest,
  bindInventoryOperation(operations.PRODUCT_BULK_UPDATE),
  updateProductsBulk
);

/**
 * @swagger
 * /api/products/bulk:
 *   delete:
 *     summary: Archive multiple inactive products (legacy DELETE)
 *     description: Atomically archives between 1 and 150 inactive products without removing documents or references. deletedCount remains a compatibility field. Available to the admin role only.
 *     deprecated: true
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ids
 *             properties:
 *               ids:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 150
 *                 items:
 *                   type: string
 *                 example:
 *                   - 6a24186174ab9f90ef69cb14
 *                   - 6a24186174ab9f90ef69cb15
 *     responses:
 *       200:
 *         description: Products deleted successfully; response data includes deletedCount
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkProductsResponse'
 *       400:
 *         description: Validation failed or duplicate product IDs were provided
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: One or more products were not found
 *       409:
 *         description: One or more products are active and must be deactivated before deletion
 *         x-error-codes:
 *           - INVALID_RESOURCE_STATE
 *           - STALE_VERSION
 *       500:
 *         description: Could not delete products
 */
router.delete(
  "/bulk",
  authenticateUser,
  authorizeRoles("admin"),
  deleteBulkProductsValidation,
  validateRequest,
  bindInventoryOperation(operations.PRODUCT_BULK_ARCHIVE),
  deleteProductsBulk
);

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Retrieve a single product
 *     description: Available to admin, manager, and viewer roles.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product retrieved successfully
 *       400:
 *         description: Invalid product ID
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Product not found
 *       500:
 *         description: Could not retrieve product
 */
router.get(
  "/:id",
  authenticateUser,
  authorizeRoles("admin", "manager", "viewer"),
  getProductById
);

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create a new product
 *     description: Available to admin and manager roles.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sku
 *               - name
 *             properties:
 *               sku:
 *                 type: string
 *                 maxLength: 64
 *                 pattern: '^[A-Z0-9_-]+$'
 *                 example: LAPTOP-001
 *               name:
 *                 type: string
 *                 maxLength: 120
 *                 example: Dell Latitude 7450
 *               description:
 *                 type: string
 *                 maxLength: 500
 *                 example: Business laptop
 *               unit:
 *                 type: string
 *                 enum: [piece, kg, liter, meter]
 *                 example: piece
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *                 example: active
 *     responses:
 *       201:
 *         description: Product created successfully
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       409:
 *         description: Product with this SKU already exists
 *       500:
 *         description: Could not create product
 */
router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  createProductValidation,
  validateRequest,
  bindInventoryOperation(operations.PRODUCT_CREATE),
  createProduct
);

/**
 * @swagger
 * /api/products/{id}:
 *   patch:
 *     summary: Update product information
 *     description: At least one of sku, name, description, unit, or status is required. Available to admin and manager roles.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               sku:
 *                 type: string
 *                 maxLength: 64
 *                 pattern: '^[A-Z0-9_-]+$'
 *                 example: LAPTOP-002
 *               name:
 *                 type: string
 *                 maxLength: 120
 *                 example: Updated Laptop
 *               description:
 *                 type: string
 *                 maxLength: 500
 *                 example: Updated product description
 *               unit:
 *                 type: string
 *                 enum: [piece, kg, liter, meter]
 *                 example: piece
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *                 example: active
 *               expectedVersion:
 *                 type: integer
 *                 minimum: 1
 *                 description: Optional transitional optimistic-concurrency precondition
 *               deactivationReason:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       400:
 *         description: Invalid product ID
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Product not found
 *       409:
 *         description: Product with this SKU already exists or the expected version is stale
 *       500:
 *         description: Could not update product
 */
router.patch(
  "/:id",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  updateProductValidation,
  validateRequest,
  bindInventoryOperation(operations.PRODUCT_UPDATE),
  updateProduct
);

/**
 * @swagger
 * /api/products/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a product
 *     description: Deactivates the Product and propagates its Stock lifecycle guards atomically. Repeating an already-applied transition is a no-op. Available to admin and manager roles.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expectedVersion:
 *                 type: integer
 *                 minimum: 1
 *               deactivationReason:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Product deactivated successfully
 *       400:
 *         description: Invalid product ID
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Product not found
 *       409:
 *         description: Expected version is stale
 *       500:
 *         description: Could not deactivate product
 */
router.patch(
  "/:id/deactivate",
  authenticateUser,
  authorizeRoles("admin", "manager"),
  deactivateProductValidation,
  validateRequest,
  bindInventoryOperation(operations.PRODUCT_DEACTIVATE),
  deactivateProduct
);

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Archive an inactive product (legacy DELETE)
 *     description: Compatibility alias that retains the Product and all references, marks it archived, and hides it from normal Product reads. Available to the admin role only.
 *     deprecated: true
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expectedVersion:
 *                 type: integer
 *                 minimum: 1
 *               archiveReason:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *       400:
 *         description: Invalid product ID
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       404:
 *         description: Product not found
 *       409:
 *         description: Active products must be deactivated before archive or the expected version is stale
 *         x-error-codes:
 *           - INVALID_RESOURCE_STATE
 *           - STALE_VERSION
 *       500:
 *         description: Could not delete product
 */
router.delete(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  archiveProductValidation,
  validateRequest,
  bindInventoryOperation(operations.PRODUCT_ARCHIVE),
  deleteProduct
);

module.exports = router;
