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

router.get("/", getProducts);

router.get("/:id", getProductById);

router.post(
  "/",
  createProductValidation,
  validateRequest,
  createProduct
);

router.patch("/:id", updateProduct);

router.patch("/:id/deactivate", deactivateProduct);

router.delete("/:id", deleteProduct);

module.exports = router;