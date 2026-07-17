const express = require("express");

const {
  loginUser,
  refreshAccessToken,
  logoutUser,
  getCurrentUser,
} = require("../controllers/authController");

const {
  loginUserValidation,
  refreshTokenValidation,
} = require("../validators/userValidator");

const validateRequest = require("../middleware/validateRequest");

const {
  authenticateUser,
} = require("../middleware/authMiddleware");

const router = express.Router();


/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@example.com
 *               password:
 *                 type: string
 *                 example: Password123
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Invalid email or password
 *       403:
 *         description: User account is inactive
 */

router.post(
  "/login",
  loginUserValidation,
  validateRequest,
  loginUser
);



/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 example: refresh_token_value
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Invalid, expired or revoked refresh token
 */

router.post(
  "/refresh",
  refreshTokenValidation,
  validateRequest,
  refreshAccessToken
);



/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 example: refresh_token_value
 *     responses:
 *       200:
 *         description: Logout successful
 *       400:
 *         description: Validation failed
 */


router.post(
  "/logout",
  refreshTokenValidation,
  validateRequest,
  logoutUser
);



/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current authenticated user
 *     tags:
 *       - Authentication
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user retrieved successfully
 *       401:
 *         description: Access token is missing, invalid or expired
 *       403:
 *         description: User account is inactive
 */

router.get(
  "/me",
  authenticateUser,
  getCurrentUser
);

module.exports = router;
