const express = require("express");

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

router.post("/", createProduct);

router.patch("/:id", updateProduct);

router.patch("/:id/deactivate", deactivateProduct);

router.delete("/:id", deleteProduct);

module.exports = router;