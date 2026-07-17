const { body } = require("express-validator");

const createProductValidation = [
  body("sku")
    .trim()
    .notEmpty()
    .withMessage("SKU is required"),

  body("name")
    .trim()
    .notEmpty()
    .withMessage("Product name is required"),

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
    .trim()
    .notEmpty()
    .withMessage("SKU cannot be empty"),

  body("name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Product name cannot be empty"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
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

const createBulkProductsValidation = [
  body()
    .isArray({ min: 1, max: 150 })
    .withMessage("Body must be an array containing between 1 and 150 products"),

  body("*.sku")
    .trim()
    .notEmpty()
    .withMessage("SKU is required")
    .bail(),

  body("*.name")
    .trim()
    .notEmpty()
    .withMessage("Product name is required")
    .bail(),

  body("*.description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim(),

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
    .trim()
    .notEmpty()
    .withMessage("SKU cannot be empty")
    .bail(),

  body("*.name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Product name cannot be empty")
    .bail(),

  body("*.description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim(),

  body("*.unit")
    .optional()
    .isIn(["piece", "kg", "liter", "meter"])
    .withMessage("Invalid product unit"),

  body("*.status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid product status"),
];

const deleteBulkProductsValidation = [
  body("ids")
    .isArray({ min: 1, max: 150 })
    .withMessage("IDs must be an array containing between 1 and 150 items"),

  body("ids.*")
    .isMongoId()
    .withMessage("Invalid product ID"),
];

module.exports = {
  createProductValidation,
  updateProductValidation,
  createBulkProductsValidation,
  updateBulkProductsValidation,
  deleteBulkProductsValidation,
};
