const { body } = require("express-validator");

const createWarehouseValidation = [
  body("code")
    .notEmpty()
    .withMessage("Warehouse code is required")
    .bail()
    .isString()
    .withMessage("Warehouse code must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Warehouse code is required")
    .bail()
    .customSanitizer((value) => value.toUpperCase())
    .isLength({ max: 64 })
    .withMessage("Warehouse code must be at most 64 characters long")
    .matches(/^[A-Z0-9_-]+$/)
    .withMessage("Warehouse code may only contain uppercase letters, numbers, dashes and underscores"),

  body("name")
    .trim()
    .notEmpty()
    .withMessage("Warehouse name is required")
    .bail()
    .isLength({ max: 120 })
    .withMessage("Warehouse name must be at most 120 characters long"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters long"),

  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid warehouse status"),
];

const updateWarehouseValidation = [
  body().custom((warehouse) => {
    if (!warehouse || typeof warehouse !== "object" || Array.isArray(warehouse)) {
      throw new Error("Request body must be an object");
    }

    if (Object.prototype.hasOwnProperty.call(warehouse, "code")) {
      throw new Error("Warehouse code cannot be updated");
    }

    const updatableFields = ["name", "description", "status"];
    const hasUpdate = updatableFields.some((field) =>
      Object.prototype.hasOwnProperty.call(warehouse, field)
    );

    if (!hasUpdate) {
      throw new Error("At least one updatable warehouse field is required");
    }

    return true;
  }),

  body("name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Warehouse name cannot be empty")
    .bail()
    .isLength({ max: 120 })
    .withMessage("Warehouse name must be at most 120 characters long"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters long"),

  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid warehouse status"),

  body("expectedVersion")
    .optional()
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

const createBulkWarehousesValidation = [
  body()
    .isArray({ min: 1, max: 150 })
    .withMessage("Body must be an array containing between 1 and 150 warehouses"),

  body("*.code")
    .notEmpty()
    .withMessage("Warehouse code is required")
    .bail()
    .isString()
    .withMessage("Warehouse code must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Warehouse code is required")
    .bail()
    .customSanitizer((value) => value.toUpperCase())
    .isLength({ max: 64 })
    .withMessage("Warehouse code must be at most 64 characters long")
    .matches(/^[A-Z0-9_-]+$/)
    .withMessage("Warehouse code may only contain uppercase letters, numbers, dashes and underscores"),

  body("*.name")
    .trim()
    .notEmpty()
    .withMessage("Warehouse name is required")
    .bail()
    .isLength({ max: 120 })
    .withMessage("Warehouse name must be at most 120 characters long"),

  body("*.description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters long"),

  body("*.status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid warehouse status"),
];

const deactivateWarehouseValidation = [
  body("expectedVersion")
    .optional()
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

const updateBulkWarehousesValidation = [
  body()
    .isArray({ min: 1, max: 150 })
    .withMessage("Body must be an array containing between 1 and 150 warehouses"),

  body("*").custom((warehouse) => {
    if (!warehouse || typeof warehouse !== "object" || Array.isArray(warehouse)) {
      throw new Error("Each warehouse must be an object");
    }

    if (Object.prototype.hasOwnProperty.call(warehouse, "code")) {
      throw new Error("Warehouse code cannot be updated");
    }

    const updatableFields = ["name", "description", "status"];
    const hasUpdate = updatableFields.some((field) =>
      Object.prototype.hasOwnProperty.call(warehouse, field)
    );

    if (!hasUpdate) {
      throw new Error("At least one updatable warehouse field is required");
    }

    return true;
  }),

  body("*.id")
    .notEmpty()
    .withMessage("Warehouse ID is required")
    .bail()
    .isMongoId()
    .withMessage("Invalid warehouse ID"),

  body("*.name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Warehouse name cannot be empty")
    .bail()
    .isLength({ max: 120 })
    .withMessage("Warehouse name must be at most 120 characters long"),

  body("*.description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters long"),

  body("*.status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid warehouse status"),

  body("*.expectedVersion")
    .optional()
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

module.exports = {
  createWarehouseValidation,
  updateWarehouseValidation,
  createBulkWarehousesValidation,
  updateBulkWarehousesValidation,
  deactivateWarehouseValidation,
};
