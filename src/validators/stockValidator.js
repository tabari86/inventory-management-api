const { body } = require("express-validator");

const createStockValidation = [
  body("productId")
    .notEmpty()
    .withMessage("Product ID is required")
    .isMongoId()
    .withMessage("Invalid product ID"),

  body("warehouseId")
    .notEmpty()
    .withMessage("Warehouse ID is required")
    .isMongoId()
    .withMessage("Invalid warehouse ID"),
];

module.exports = {
  createStockValidation,
};