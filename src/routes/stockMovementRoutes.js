const express = require("express");

const {
  createStockMovement,
  getStockMovements,
  getStockMovementById,
} = require("../controllers/stockMovementController");

const router = express.Router();

router.get("/", getStockMovements);

router.get("/:id", getStockMovementById);

router.post("/", createStockMovement);

module.exports = router;