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
    .withMessage("Quantity must be greater than 0")
    .toInt(),

  body("reference")
    .optional()
    .isString()
    .withMessage("Reference must be a string")
    .bail()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Reference must be at most 100 characters long"),

  body("reason")
    .optional()
    .isString()
    .withMessage("Reason must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Reason must be at most 500 characters long"),
];

const createBulkGoodsIssueValidation = [
  body()
    .isArray({ min: 1, max: 150 })
    .withMessage("Body must be an array containing between 1 and 150 goods issues"),

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
    .trim()
    .isLength({ max: 100 })
    .withMessage("Reference must be at most 100 characters long"),

  body("*.reason")
    .optional()
    .isString()
    .withMessage("Reason must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Reason must be at most 500 characters long"),
];

module.exports = {
  createGoodsIssueValidation,
  createBulkGoodsIssueValidation,
};
