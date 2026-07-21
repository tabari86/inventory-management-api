const DomainError = require("../errors/DomainError");

const errorHandler = (error, req, res, next) => {
  const isDomainError = error instanceof DomainError;
  const statusCode = isDomainError
    ? error.httpStatus
    : error.statusCode || 500;
  const hideInternalDetails =
    process.env.NODE_ENV === "production" && statusCode >= 500;
  const clientMessage = isDomainError
    ? error.safeMessage
    : error.clientMessage || error.message;

  return res.status(statusCode).json({
    message: hideInternalDetails
      ? "Internal server error"
      : clientMessage || "Internal server error",
  });
};
module.exports = errorHandler;
