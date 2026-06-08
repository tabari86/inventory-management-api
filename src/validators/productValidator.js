const { body } = require("express-validator");

const createProductValidation = [
  body("sku")
    .notEmpty()
    .withMessage("SKU is required")
    .trim(),

  body("name")
    .notEmpty()
    .withMessage("Product name is required")
    .trim(),

  body("unit")
    .optional()
    .isIn(["piece", "kg", "liter", "meter"])
    .withMessage("Invalid product unit"),

  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid product status"),
];

module.exports = {
  createProductValidation,
};
