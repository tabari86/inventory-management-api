const { body } = require("express-validator");

const createWarehouseValidation = [
  body("code")
    .trim()
    .notEmpty()
    .withMessage("Warehouse code is required"),

  body("name")
    .trim()
    .notEmpty()
    .withMessage("Warehouse name is required"),

  body("description")
    .optional()
    .trim(),

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
    .withMessage("Warehouse name cannot be empty"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim(),

  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid warehouse status"),
];

const createBulkWarehousesValidation = [
  body()
    .isArray({ min: 1, max: 150 })
    .withMessage("Body must be an array containing between 1 and 150 warehouses"),

  body("*.code")
    .trim()
    .notEmpty()
    .withMessage("Warehouse code is required")
    .bail(),

  body("*.name")
    .trim()
    .notEmpty()
    .withMessage("Warehouse name is required")
    .bail(),

  body("*.description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim(),

  body("*.status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid warehouse status"),
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
    .bail(),

  body("*.description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim(),

  body("*.status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Invalid warehouse status"),
];

module.exports = {
  createWarehouseValidation,
  updateWarehouseValidation,
  createBulkWarehousesValidation,
  updateBulkWarehousesValidation,
};
