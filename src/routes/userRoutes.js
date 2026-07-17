const express = require("express");

const { createUser } = require("../controllers/userController");
const { authenticateUser } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { createUserValidation } = require("../validators/userValidator");

const router = express.Router();

router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  createUserValidation,
  validateRequest,
  createUser
);

module.exports = router;
