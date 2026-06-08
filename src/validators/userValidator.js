const { body } = require("express-validator");

const registerUserValidation = [
  body("name")
    .notEmpty()
    .withMessage("Name is required")
    .bail()
    .trim(),

  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .bail()
    .isEmail()
    .withMessage("Invalid email address")
    .bail()
    .normalizeEmail(),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .bail()
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long"),

  body("role")
    .optional()
    .isIn(["admin", "manager", "viewer"])
    .withMessage("Invalid user role"),
];

const loginUserValidation = [
  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .bail()
    .isEmail()
    .withMessage("Invalid email address")
    .bail()
    .normalizeEmail(),

  body("password")
    .notEmpty()
    .withMessage("Password is required"),
];

const refreshTokenValidation = [
  body("refreshToken")
    .notEmpty()
    .withMessage("Refresh token is required"),
];

module.exports = {
  registerUserValidation,
  loginUserValidation,
  refreshTokenValidation,
};