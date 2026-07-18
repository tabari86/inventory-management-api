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
const loginRateLimiter = require("../middleware/loginRateLimiter");

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
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: User account is inactive
 *       429:
 *         description: Too many login attempts
 *       500:
 *         description: Could not login user
 */

router.post(
  "/login",
  loginRateLimiter,
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
 *       403:
 *         description: User account is inactive
 *       500:
 *         description: Could not refresh token
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
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessageResponse'
 *       400:
 *         description: Validation failed
 *       500:
 *         description: Could not logout user
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
 *     description: Returns the current authenticated active user.
 *     tags:
 *       - Authentication
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user retrieved successfully
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive
 *       500:
 *         description: Could not retrieve current user
 */

router.get(
  "/me",
  authenticateUser,
  getCurrentUser
);

module.exports = router;
