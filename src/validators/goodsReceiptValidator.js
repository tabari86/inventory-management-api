const { body } = require("express-validator");

const createGoodsReceiptValidation = [
  body("stockId")
    .notEmpty()
    .withMessage("Stock ID is required")
    .isMongoId()
    .withMessage("Invalid stock ID"),

  body("quantity")
    .notEmpty()
    .withMessage("Quantity is required")
    .isInt({ min: 1 })
    .withMessage("Quantity must be greater than 0")
    .toInt(),

  body("reference")
    .optional()
    .trim(),

  body("reason")
    .optional()
    .trim(),
];

const createBulkGoodsReceiptValidation = [
  body()
    .isArray({ min: 1, max: 150 })
    .withMessage("Body must be an array containing between 1 and 150 goods receipts"),

  body("*.stockId")
    .notEmpty()
    .withMessage("Stock ID is required")
    .bail()
    .isMongoId()
    .withMessage("Invalid stock ID"),

  body("*.quantity")
    .notEmpty()
    .withMessage("Quantity is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("Quantity must be greater than 0")
    .toInt(),

  body("*.reference")
    .optional()
    .isString()
    .withMessage("Reference must be a string")
    .bail()
    .trim(),

  body("*.reason")
    .optional()
    .isString()
    .withMessage("Reason must be a string")
    .bail()
    .trim(),
];

module.exports = {
  createGoodsReceiptValidation,
  createBulkGoodsReceiptValidation,
};
