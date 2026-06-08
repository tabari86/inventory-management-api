const express = require("express");
const {
  createProductValidation,
} = require("../validators/productValidator");

const validateRequest = require("../middleware/validateRequest");

const {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deactivateProduct,
  deleteProduct,
} = require("../controllers/productController");

const router = express.Router();



/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Retrieve all products
 *     tags:
 *       - Products
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *       500:
 *         description: Could not retrieve products
 */
router.get("/", getProducts);



/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Retrieve a single product
 *     tags:
 *       - Products
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
 *       404:
 *         description: Product not found
 */
router.get("/:id", getProductById);



/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create a new product
 *     tags:
 *       - Products
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
 *                 example: LAPTOP-001
 *               name:
 *                 type: string
 *                 example: Dell Latitude 7450
 *               description:
 *                 type: string
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
 *       409:
 *         description: Product with this SKU already exists
 *       500:
 *         description: Could not create product
 */
router.post(
  "/",
  createProductValidation,
  validateRequest,
  createProduct
);



/**
 * @swagger
 * /api/products/{id}:
 *   patch:
 *     summary: Update product information
 *     tags:
 *       - Products
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
 *             properties:
 *               sku:
 *                 type: string
 *                 example: LAPTOP-002
 *               name:
 *                 type: string
 *                 example: Updated Laptop
 *               description:
 *                 type: string
 *                 example: Updated product description
 *               unit:
 *                 type: string
 *                 enum: [piece, kg, liter, meter]
 *                 example: piece
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *                 example: active
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       400:
 *         description: Invalid product ID
 *       404:
 *         description: Product not found
 *       409:
 *         description: Product with this SKU already exists
 */
router.patch("/:id", updateProduct);



/**
 * @swagger
 * /api/products/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a product
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product deactivated successfully
 *       400:
 *         description: Invalid product ID
 *       404:
 *         description: Product not found
 */
router.patch("/:id/deactivate", deactivateProduct);



/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete an inactive product
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *       400:
 *         description: Invalid product ID
 *       404:
 *         description: Product not found
 *       409:
 *         description: Active products must be deactivated before deletion
 */
router.delete("/:id", deleteProduct);


module.exports = router;