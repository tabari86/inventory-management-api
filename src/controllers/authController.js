const authService = require("../services/authService");
const { sendSuccess } = require("../http/contract");

const loginUser = async (req, res, next) => {
  try {
    const result = await authService.login({
      email: req.body.email,
      password: req.body.password,
      applicationContext: req.applicationContext,
    });

    return sendSuccess(req, res, {
      statusCode: 200,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
};

const refreshAccessToken = async (req, res, next) => {
  try {
    const result = await authService.rotateRefreshToken({
      refreshToken: req.body.refreshToken,
    });

    return sendSuccess(req, res, {
      statusCode: 200,
      message: "Token refreshed successfully",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
};

const logoutUser = async (req, res, next) => {
  try {
    await authService.logout({ refreshToken: req.body.refreshToken });

    return sendSuccess(req, res, {
      statusCode: 200,
      message: "Logout successful",
    });
  } catch (error) {
    return next(error);
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
    return next(error);
  }
};

module.exports = {
  loginUser,
  refreshAccessToken,
  logoutUser,
  getCurrentUser,
};
