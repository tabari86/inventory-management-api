const express = require("express");
const {
  createWarehouseValidation,
} = require("../validators/warehouseValidator");

const validateRequest = require("../middleware/validateRequest");

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

router.post(
  "/",
  createWarehouseValidation,
  validateRequest,
  createWarehouse
);

router.patch("/:id", updateWarehouse);

router.patch("/:id/deactivate", deactivateWarehouse);

module.exports = router;