const express = require("express");

const {
  createWarehouse,
  getWarehouses,
  getWarehouseById,
  updateWarehouse,
  deactivateWarehouse,
} = require("../controllers/warehouseController");

const router = express.Router();

router.get("/", getWarehouses);

router.get("/:id", getWarehouseById);

router.post("/", createWarehouse);

router.patch("/:id", updateWarehouse);

router.patch("/:id/deactivate", deactivateWarehouse);

module.exports = router;