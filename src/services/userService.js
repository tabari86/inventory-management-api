const bcrypt = require("bcrypt");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const normalizeServiceError = require("../errors/normalizeServiceError");
const User = require("../models/User");

const USER_ROLES = new Set(["manager", "viewer"]);
const USER_VALIDATION_PATHS = Object.freeze({
  name: Object.freeze({ required: "Name is required" }),
  email: Object.freeze({ required: "Email is required" }),
  password: Object.freeze({ required: "Password is required" }),
  role: Object.freeze({ enum: "Role must be manager or viewer" }),
});

const duplicateUserError = (cause) =>
  new DomainError({
    code: errorCodes.DUPLICATE_RESOURCE,
    httpStatus: 409,
    message: "A user with this email already exists",
    retryable: false,
    cause,
  });

const validationError = (field, message) =>
  new DomainError({
    code: errorCodes.VALIDATION_FAILED,
    httpStatus: 400,
    message,
    retryable: false,
    errors: [{ field, message }],
  });

const assertCreateUserCommand = ({ name, email, password, role }) => {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw validationError("name", "Name is required");
  }
  if (name.trim().length > 120) {
    throw validationError("name", "Name must be at most 120 characters long");
  }
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    throw validationError("email", "Invalid email address");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw validationError(
      "password",
      "Password must be at least 8 characters long"
    );
  }
  if (!USER_ROLES.has(role)) {
    throw validationError("role", "Role must be manager or viewer");
  }
};

const createUser = async (command = {}) => {
  const { name, email, password, role = "viewer" } = command;
  assertCreateUserCommand({ name, email, password, role });

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) throw duplicateUserError();

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
      status: "active",
    });

    return {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error?.code === 11000) throw duplicateUserError(error);

    throw normalizeServiceError(error, {
      safeMessage: "Could not create user",
      validationPaths: USER_VALIDATION_PATHS,
    });
  }
};

module.exports = {
  createUser,
};
