const express = require("express");

const {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  getCurrentUser,
} = require("../controllers/authController");

const {
  registerUserValidation,
  loginUserValidation,
  refreshTokenValidation,
} = require("../validators/userValidator");

const validateRequest = require("../middleware/validateRequest");

const {
  authenticateUser,
} = require("../middleware/authMiddleware");

const router = express.Router();

router.post(
  "/register",
  registerUserValidation,
  validateRequest,
  registerUser
);

router.post(
  "/login",
  loginUserValidation,
  validateRequest,
  loginUser
);

router.post(
  "/refresh",
  refreshTokenValidation,
  validateRequest,
  refreshAccessToken
);

router.post(
  "/logout",
  refreshTokenValidation,
  validateRequest,
  logoutUser
);

router.get(
  "/me",
  authenticateUser,
  getCurrentUser
);

module.exports = router;