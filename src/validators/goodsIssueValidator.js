const { body } = require("express-validator");

const createGoodsIssueValidation = [
  body("stockId")
    .notEmpty()
    .withMessage("Stock ID is required")
    .isMongoId()
    .withMessage("Invalid stock ID"),

  body("quantity")
    .notEmpty()
    .withMessage("Quantity is required")
    .isInt({ min: 1 })
    .withMessage("Quantity must be greater than 0"),

  body("reference")
    .optional()
    .trim(),

  body("reason")
    .optional()
    .trim(),
];

module.exports = {
  createGoodsIssueValidation,
};