const { body } = require("express-validator");

const createWarehouseValidation = [
  body("code")
    .notEmpty()
    .withMessage("Warehouse code is required")
    .trim(),

  body("name")
    .notEmpty()
    .withMessage("Warehouse name is required")
    .trim(),

  body("description")
    .optional()
    .trim(),

  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid warehouse status"),
];

module.exports = {
  createWarehouseValidation,
};