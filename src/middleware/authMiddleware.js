const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../models/User");
const errorCodes = require("../errors/errorCodes");
const { sendError } = require("../http/contract");

const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return sendError(req, res, {
      statusCode: 401,
      code: errorCodes.AUTHENTICATION_REQUIRED,
      detail: "Access token is required",
    });
  }

  const token = authHeader.split(" ")[1];
  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (_error) {
    return sendError(req, res, {
      statusCode: 401,
      code: errorCodes.INVALID_ACCESS_TOKEN,
      detail: "Invalid or expired access token",
    });
  }

  if (
    typeof decoded.userId !== "string" ||
    !/^[a-fA-F0-9]{24}$/.test(decoded.userId) ||
    !mongoose.Types.ObjectId.isValid(decoded.userId)
  ) {
    return sendError(req, res, {
      statusCode: 401,
      code: errorCodes.INVALID_ACCESS_TOKEN,
      detail: "Invalid or expired access token",
    });
  }

  let user;
  try {
    user = await User.findById(decoded.userId);
  } catch (error) {
    return next(error);
  }

  if (!user) {
    return sendError(req, res, {
      statusCode: 401,
      code: errorCodes.INVALID_ACCESS_TOKEN,
      detail: "Invalid or expired access token",
      legacyMessage: "User not found",
    });
  }

  if (user.status !== "active") {
    return sendError(req, res, {
      statusCode: 403,
      code: errorCodes.ACCESS_DENIED,
      detail: "User account is inactive",
    });
  }

  req.user = {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
  };

  req.applicationContext.actor = {
    type: "user",
    id: user._id.toString(),
  };

  next();
};

module.exports = {
  authenticateUser,
};
