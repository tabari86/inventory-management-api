const { body } = require("express-validator");
const {
  PASSWORD_BYTE_LIMIT_MESSAGE,
  isPasswordWithinBcryptLimit,
} = require("../utils/bcryptPasswordBoundary");

const isPrimitiveString = (value) => typeof value === "string";

const createUserValidation = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .bail()
    .isLength({ max: 120 })
    .withMessage("Name must be at most 120 characters long"),

  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .bail()
    .isEmail()
    .withMessage("Invalid email address")
    .bail()
    .normalizeEmail(),

  body("password")
    .custom(isPrimitiveString)
    .withMessage("Password must be a string")
    .bail()
    .notEmpty()
    .withMessage("Password is required")
    .bail()
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long")
    .bail()
    .custom(isPasswordWithinBcryptLimit)
    .withMessage(PASSWORD_BYTE_LIMIT_MESSAGE),

  body("role")
    .optional()
    .isIn(["manager", "viewer"])
    .withMessage("Role must be manager or viewer"),
];

const loginUserValidation = [
  body("email")
    .custom(isPrimitiveString)
    .withMessage("Email must be a string")
    .bail()
    .notEmpty()
    .withMessage("Email is required")
    .bail()
    .isEmail()
    .withMessage("Invalid email address")
    .bail()
    .normalizeEmail(),

  body("password")
    .custom(isPrimitiveString)
    .withMessage("Password must be a string")
    .bail()
    .notEmpty()
    .withMessage("Password is required")
    .bail()
    .custom(isPasswordWithinBcryptLimit)
    .withMessage(PASSWORD_BYTE_LIMIT_MESSAGE),
];

const refreshTokenValidation = [
  body("refreshToken")
    .custom(isPrimitiveString)
    .withMessage("Refresh token must be a string")
    .bail()
    .notEmpty()
    .withMessage("Refresh token is required"),
];

module.exports = {
  createUserValidation,
  loginUserValidation,
  refreshTokenValidation,
};
