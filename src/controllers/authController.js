const bcrypt = require("bcrypt");

const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const RefreshToken = require("../models/RefreshToken");
const { logger } = require("../config/logger");
const errorCodes = require("../errors/errorCodes");
const { sendError, sendSuccess } = require("../http/contract");

const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return sendError(req, res, {
        statusCode: 401,
        code: errorCodes.AUTHENTICATION_FAILED,
        detail: "Invalid email or password",
      });
    }

    if (user.status !== "active") {
      return sendError(req, res, {
        statusCode: 403,
        code: errorCodes.ACCESS_DENIED,
        detail: "User account is inactive",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return sendError(req, res, {
        statusCode: 401,
        code: errorCodes.AUTHENTICATION_FAILED,
        detail: "Invalid email or password",
      });
    }

    const accessToken = jwt.sign(
      {
        userId: user._id,
        role: user.role,
      },
      process.env.JWT_ACCESS_SECRET,
      {
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
      }
    );

    const refreshToken = crypto.randomBytes(64).toString("hex");
    const refreshTokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const storedRefreshToken = await RefreshToken.create({
      userId: user._id,
      tokenHash: refreshTokenHash,
      expiresAt,
    });

    try {
      await RefreshToken.updateMany(
        {
          userId: user._id,
          _id: { $ne: storedRefreshToken._id },
          isRevoked: false,
        },
        { $set: { isRevoked: true } }
      );
    } catch (_revocationError) {
      logger.log("application_error", {
        requestId: req.applicationContext?.requestId,
        correlationId: req.applicationContext?.correlationId,
        statusCode: 500,
        errorCode: "REFRESH_TOKEN_REVOCATION_FAILED",
        retryable: true,
      });
    }

    return sendSuccess(req, res, {
      statusCode: 200,
      message: "Login successful",
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
        },
      },
    });
  } catch (error) {
    error.message = "Could not login user";
    next(error);
  }
};

const refreshAccessToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    const refreshTokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    const storedRefreshToken = await RefreshToken.findOne({
      tokenHash: refreshTokenHash,
    });

    if (!storedRefreshToken) {
      return sendError(req, res, {
        statusCode: 401,
        code: errorCodes.INVALID_REFRESH_TOKEN,
        detail: "Invalid refresh token",
      });
    }

    if (storedRefreshToken.isRevoked) {
      return sendError(req, res, {
        statusCode: 401,
        code: errorCodes.INVALID_REFRESH_TOKEN,
        detail: "Refresh token has been revoked",
      });
    }

    if (storedRefreshToken.expiresAt < new Date()) {
      return sendError(req, res, {
        statusCode: 401,
        code: errorCodes.INVALID_REFRESH_TOKEN,
        detail: "Refresh token has expired",
      });
    }

    const user = await User.findById(storedRefreshToken.userId);

    if (!user) {
      return sendError(req, res, {
        statusCode: 401,
        code: errorCodes.INVALID_REFRESH_TOKEN,
        detail: "Invalid refresh token",
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

    storedRefreshToken.isRevoked = true;
    await storedRefreshToken.save();

    const accessToken = jwt.sign(
      {
        userId: user._id,
        role: user.role,
      },
      process.env.JWT_ACCESS_SECRET,
      {
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
      }
    );

    const newRefreshToken = crypto.randomBytes(64).toString("hex");

    const newRefreshTokenHash = crypto
      .createHash("sha256")
      .update(newRefreshToken)
      .digest("hex");

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await RefreshToken.create({
      userId: user._id,
      tokenHash: newRefreshTokenHash,
      expiresAt,
    });

    return sendSuccess(req, res, {
      statusCode: 200,
      message: "Token refreshed successfully",
      data: {
        accessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    error.message = "Could not refresh token";
    next(error);
  }
};

const logoutUser = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    const refreshTokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    const storedRefreshToken = await RefreshToken.findOne({
      tokenHash: refreshTokenHash,
    });

    if (storedRefreshToken && !storedRefreshToken.isRevoked) {
      storedRefreshToken.isRevoked = true;
      await storedRefreshToken.save();
    }

    return sendSuccess(req, res, {
      statusCode: 200,
      message: "Logout successful",
    });
  } catch (error) {
    error.message = "Could not logout user";
    next(error);
  }
};

const getCurrentUser = async (req, res, next) => {
  try {
    return sendSuccess(req, res, {
      statusCode: 200,
      message: "Current user retrieved successfully",
      data: req.user,
    });
  } catch (error) {
    error.message = "Could not retrieve current user";
    next(error);
  }
};

module.exports = {
  loginUser,
  refreshAccessToken,
  logoutUser,
  getCurrentUser,
};
