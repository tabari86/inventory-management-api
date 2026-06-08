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

router.get("/", getStocks);

router.get("/:id", getStockById);

router.post(
  "/",
  createStockValidation,
  validateRequest,
  createStock
);

module.exports = router;