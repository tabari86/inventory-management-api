const bcrypt = require("bcrypt");

const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const RefreshToken = require("../models/RefreshToken");

const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        message: "User account is inactive",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Invalid email or password",
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
    } catch (revocationError) {
      console.error(
        `Could not revoke previous refresh tokens: ${revocationError.message}`
      );
    }

    return res.status(200).json({
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
      return res.status(401).json({
        message: "Invalid refresh token",
      });
    }

    if (storedRefreshToken.isRevoked) {
      return res.status(401).json({
        message: "Refresh token has been revoked",
      });
    }

    if (storedRefreshToken.expiresAt < new Date()) {
      return res.status(401).json({
        message: "Refresh token has expired",
      });
    }

    const user = await User.findById(storedRefreshToken.userId);

    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        message: "User account is inactive",
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

    return res.status(200).json({
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

    return res.status(200).json({
      message: "Logout successful",
    });
  } catch (error) {
    error.message = "Could not logout user";
    next(error);
  }
};

const getCurrentUser = async (req, res, next) => {
  try {
    return res.status(200).json({
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
