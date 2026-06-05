const express = require("express");

const {
  createProduct,
  getProducts,
} = require("../controllers/productController");

const router = express.Router();

router.get("/", getProducts);

router.post("/", createProduct);

module.exports = router;