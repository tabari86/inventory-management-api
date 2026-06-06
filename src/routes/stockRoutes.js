const express = require("express");

const {
  createStock,
  getStocks,
  getStockById,
} = require("../controllers/stockController");

const router = express.Router();

router.get("/", getStocks);

router.get("/:id", getStockById);

router.post("/", createStock);

module.exports = router;