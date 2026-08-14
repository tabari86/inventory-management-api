const { body } = require("express-validator");

const createProductValidation = [
  body("sku")
    .notEmpty()
    .withMessage("SKU is required")
    .bail()
    .isString()
    .withMessage("SKU must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("SKU is required")
    .bail()
    .customSanitizer((value) => value.toUpperCase())
    .isLength({ max: 64 })
    .withMessage("SKU must be at most 64 characters long")
    .matches(/^[A-Z0-9_-]+$/)
    .withMessage("SKU may only contain uppercase letters, numbers, dashes and underscores"),

  body("name")
    .trim()
    .notEmpty()
    .withMessage("Product name is required")
    .bail()
    .isLength({ max: 120 })
    .withMessage("Product name must be at most 120 characters long"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters long"),

  body("unit")
    .optional()
    .isIn(["piece", "kg", "liter", "meter"])
    .withMessage("Invalid product unit"),

  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid product status"),
];

const updateProductValidation = [
  body().custom((product) => {
    if (!product || typeof product !== "object" || Array.isArray(product)) {
      throw new Error("Request body must be an object");
    }

    const updatableFields = ["sku", "name", "description", "unit", "status"];
    const hasUpdate = updatableFields.some((field) =>
      Object.prototype.hasOwnProperty.call(product, field)
    );

    if (!hasUpdate) {
      throw new Error("At least one updatable product field is required");
    }

    return true;
  }),

  body("sku")
    .optional()
    .isString()
    .withMessage("SKU must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("SKU cannot be empty")
    .bail()
    .customSanitizer((value) => value.toUpperCase())
    .isLength({ max: 64 })
    .withMessage("SKU must be at most 64 characters long")
    .matches(/^[A-Z0-9_-]+$/)
    .withMessage("SKU may only contain uppercase letters, numbers, dashes and underscores"),

  body("name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Product name cannot be empty")
    .bail()
    .isLength({ max: 120 })
    .withMessage("Product name must be at most 120 characters long"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters long"),

  body("unit")
    .optional()
    .isIn(["piece", "kg", "liter", "meter"])
    .withMessage("Invalid product unit"),

  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid product status"),

  body("expectedVersion")
    .exists()
    .withMessage("Expected version is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("Expected version must be a positive integer")
    .toInt(),

  body("deactivationReason")
    .optional()
    .isString()
    .withMessage("Deactivation reason must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Deactivation reason must be at most 500 characters long"),
];

const createBulkProductsValidation = [
  body()
    .isArray({ min: 1, max: 150 })
    .withMessage("Body must be an array containing between 1 and 150 products"),

  body("*.sku")
    .notEmpty()
    .withMessage("SKU is required")
    .bail()
    .isString()
    .withMessage("SKU must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("SKU is required")
    .bail()
    .customSanitizer((value) => value.toUpperCase())
    .isLength({ max: 64 })
    .withMessage("SKU must be at most 64 characters long")
    .matches(/^[A-Z0-9_-]+$/)
    .withMessage("SKU may only contain uppercase letters, numbers, dashes and underscores"),

  body("*.name")
    .trim()
    .notEmpty()
    .withMessage("Product name is required")
    .bail()
    .isLength({ max: 120 })
    .withMessage("Product name must be at most 120 characters long"),

  body("*.description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters long"),

  body("*.unit")
    .optional()
    .isIn(["piece", "kg", "liter", "meter"])
    .withMessage("Invalid product unit"),

  body("*.status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid product status"),
];

const updateBulkProductsValidation = [
  body()
    .isArray({ min: 1, max: 150 })
    .withMessage("Body must be an array containing between 1 and 150 products"),

  body("*").custom((product) => {
    if (!product || typeof product !== "object" || Array.isArray(product)) {
      throw new Error("Each product must be an object");
    }

    const updatableFields = ["sku", "name", "description", "unit", "status"];
    const hasUpdate = updatableFields.some((field) =>
      Object.prototype.hasOwnProperty.call(product, field)
    );

    if (!hasUpdate) {
      throw new Error("At least one updatable product field is required");
    }

    return true;
  }),

  body("*.id")
    .notEmpty()
    .withMessage("Product ID is required")
    .bail()
    .isMongoId()
    .withMessage("Invalid product ID"),

  body("*.sku")
    .optional()
    .isString()
    .withMessage("SKU must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("SKU cannot be empty")
    .bail()
    .customSanitizer((value) => value.toUpperCase())
    .isLength({ max: 64 })
    .withMessage("SKU must be at most 64 characters long")
    .matches(/^[A-Z0-9_-]+$/)
    .withMessage("SKU may only contain uppercase letters, numbers, dashes and underscores"),

  body("*.name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Product name cannot be empty")
    .bail()
    .isLength({ max: 120 })
    .withMessage("Product name must be at most 120 characters long"),

  body("*.description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters long"),

  body("*.unit")
    .optional()
    .isIn(["piece", "kg", "liter", "meter"])
    .withMessage("Invalid product unit"),

  body("*.status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid product status"),

  body("*.expectedVersion")
    .exists()
    .withMessage("Expected version is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("Expected version must be a positive integer")
    .toInt(),

  body("*.deactivationReason")
    .optional()
    .isString()
    .withMessage("Deactivation reason must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Deactivation reason must be at most 500 characters long"),
];

const deleteBulkProductsValidation = [
  body("items")
    .isArray({ min: 1, max: 150 })
    .withMessage("Items must be an array containing between 1 and 150 products"),

  body("items.*").custom((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each archive item must be an object");
    }
    return true;
  }),

  body("items.*.id")
    .notEmpty()
    .withMessage("Product ID is required")
    .bail()
    .isMongoId()
    .withMessage("Invalid product ID"),

  body("items.*.expectedVersion")
    .exists()
    .withMessage("Expected version is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("Expected version must be a positive integer")
    .toInt(),
];

const deactivateProductValidation = [
  body("expectedVersion")
    .exists()
    .withMessage("Expected version is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("Expected version must be a positive integer")
    .toInt(),

  body("deactivationReason")
    .optional()
    .isString()
    .withMessage("Deactivation reason must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Deactivation reason must be at most 500 characters long"),
];

const archiveProductValidation = [
  body("expectedVersion")
    .exists()
    .withMessage("Expected version is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("Expected version must be a positive integer")
    .toInt(),

  body("archiveReason")
    .optional()
    .isString()
    .withMessage("Archive reason must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Archive reason must be at most 500 characters long"),
];

module.exports = {
  createProductValidation,
  updateProductValidation,
  createBulkProductsValidation,
  updateBulkProductsValidation,
  deleteBulkProductsValidation,
  deactivateProductValidation,
  archiveProductValidation,
};
