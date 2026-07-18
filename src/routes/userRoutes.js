const express = require("express");

const { createUser } = require("../controllers/userController");
const { authenticateUser } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { createUserValidation } = require("../validators/userValidator");

const router = express.Router();

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a user
 *     description: Available to the admin role only.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 example: Warehouse Manager
 *               email:
 *                 type: string
 *                 format: email
 *                 example: manager@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: Password123
 *               role:
 *                 type: string
 *                 enum: [manager, viewer]
 *                 default: viewer
 *                 example: manager
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationErrorResponse'
 *       401:
 *         description: Access token is missing or invalid
 *       403:
 *         description: User account is inactive or access is denied
 *       409:
 *         description: A user with this email already exists
 *       500:
 *         description: Could not create user
 */
router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  createUserValidation,
  validateRequest,
  createUser
);

module.exports = router;
