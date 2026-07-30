const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const { logger } = require("../config/logger");
const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const RefreshToken = require("../models/RefreshToken");
const User = require("../models/User");
const withTransaction = require("../utils/transaction");

const REFRESH_TOKEN_BYTES = 64;
const REFRESH_TOKEN_LIFETIME_DAYS = 7;

const domainError = ({ code, httpStatus, message }) =>
  new DomainError({
    code,
    httpStatus,
    message,
    retryable: false,
  });

const invalidCredentialsError = () =>
  domainError({
    code: errorCodes.AUTHENTICATION_FAILED,
    httpStatus: 401,
    message: "Invalid email or password",
  });

const inactiveUserError = () =>
  domainError({
    code: errorCodes.ACCESS_DENIED,
    httpStatus: 403,
    message: "User account is inactive",
  });

const invalidRefreshTokenError = () =>
  domainError({
    code: errorCodes.INVALID_REFRESH_TOKEN,
    httpStatus: 401,
    message: "Invalid refresh token",
  });

const unexpectedServiceError = (error, message) => {
  if (error instanceof DomainError) return error;

  return new DomainError({
    code: errorCodes.INTERNAL_ERROR,
    httpStatus: 500,
    message,
    safeMessage: message,
    retryable: false,
    cause: error,
  });
};

const hashRefreshToken = (refreshToken) =>
  crypto.createHash("sha256").update(refreshToken).digest("hex");

const createRefreshTokenMaterial = (now = new Date()) => {
  const refreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_LIFETIME_DAYS);

  return {
    refreshToken,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
  };
};

const createAccessToken = (user) =>
  jwt.sign(
    {
      userId: user._id,
      role: user.role,
    },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    }
  );

const presentUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
});

const login = async ({ email, password, applicationContext = {} }) => {
  try {
    const user = await User.findOne({ email }).select("+password");

    if (!user) throw invalidCredentialsError();
    if (user.status !== "active") throw inactiveUserError();

    const passwordIsValid = await bcrypt.compare(password, user.password);
    if (!passwordIsValid) throw invalidCredentialsError();

    const accessToken = createAccessToken(user);
    const tokenMaterial = createRefreshTokenMaterial();
    const storedRefreshToken = await RefreshToken.create({
      userId: user._id,
      tokenHash: tokenMaterial.tokenHash,
      expiresAt: tokenMaterial.expiresAt,
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
        requestId: applicationContext.requestId,
        correlationId: applicationContext.correlationId,
        statusCode: 500,
        errorCode: "REFRESH_TOKEN_REVOCATION_FAILED",
        retryable: true,
      });
    }

    return {
      accessToken,
      refreshToken: tokenMaterial.refreshToken,
      user: presentUser(user),
    };
  } catch (error) {
    throw unexpectedServiceError(error, "Could not login user");
  }
};

const rotateRefreshToken = async ({ refreshToken }) => {
  try {
    return await withTransaction(async (session) => {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const now = new Date();
      const storedRefreshToken = await RefreshToken.findOneAndUpdate(
        {
          tokenHash: refreshTokenHash,
          isRevoked: false,
          expiresAt: { $gt: now },
        },
        { $set: { isRevoked: true } },
        { returnDocument: "after", session }
      );

      if (!storedRefreshToken) throw invalidRefreshTokenError();

      const user = await User.findById(storedRefreshToken.userId).session(
        session
      );
      if (!user) throw invalidRefreshTokenError();
      if (user.status !== "active") throw inactiveUserError();

      const accessToken = createAccessToken(user);
      const tokenMaterial = createRefreshTokenMaterial(now);
      await RefreshToken.create(
        [
          {
            userId: user._id,
            tokenHash: tokenMaterial.tokenHash,
            expiresAt: tokenMaterial.expiresAt,
          },
        ],
        { session }
      );

      return {
        accessToken,
        refreshToken: tokenMaterial.refreshToken,
      };
    });
  } catch (error) {
    throw unexpectedServiceError(error, "Could not refresh token");
  }
};

const logout = async ({ refreshToken }) => {
  try {
    const refreshTokenHash = hashRefreshToken(refreshToken);
    await RefreshToken.updateOne(
      { tokenHash: refreshTokenHash, isRevoked: false },
      { $set: { isRevoked: true } }
    );
  } catch (error) {
    throw unexpectedServiceError(error, "Could not logout user");
  }
};

module.exports = {
  login,
  logout,
  rotateRefreshToken,
};
