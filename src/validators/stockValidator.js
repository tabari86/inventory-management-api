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

const createBulkStocksValidation = [
  body()
    .isArray({ min: 1, max: 150 })
    .withMessage("Body must be an array containing between 1 and 150 stock records"),

  body("*.productId")
    .notEmpty()
    .withMessage("Product ID is required")
    .bail()
    .isMongoId()
    .withMessage("Invalid product ID"),

  body("*.warehouseId")
    .notEmpty()
    .withMessage("Warehouse ID is required")
    .bail()
    .isMongoId()
    .withMessage("Invalid warehouse ID"),
];

module.exports = {
  createStockValidation,
  createBulkStocksValidation,
};
