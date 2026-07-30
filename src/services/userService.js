const bcrypt = require("bcrypt");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const User = require("../models/User");

const duplicateUserError = () =>
  new DomainError({
    code: errorCodes.DUPLICATE_RESOURCE,
    httpStatus: 409,
    message: "A user with this email already exists",
    retryable: false,
  });

const createUser = async ({ name, email, password, role = "viewer" }) => {
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
    if (error?.code === 11000) throw duplicateUserError();

    throw new DomainError({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      message: "Could not create user",
      safeMessage: "Could not create user",
      retryable: false,
      cause: error,
    });
  }
};

module.exports = {
  createUser,
};
