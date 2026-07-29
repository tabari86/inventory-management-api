const errorCodes = require("../errors/errorCodes");
const { sendError } = require("../http/contract");

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return sendError(req, res, {
        statusCode: 403,
        code: errorCodes.ACCESS_DENIED,
        detail: "Access denied",
      });
    }

    next();
  };
};

module.exports = {
  authorizeRoles,
};
