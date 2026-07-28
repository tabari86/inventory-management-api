const DomainError = require("../errors/DomainError");
const { logger: defaultLogger } = require("../config/logger");

const createErrorHandler = (logger = defaultLogger) =>
  function errorHandler(error, req, res, _next) {
    const isDomainError = error instanceof DomainError;
    const statusCode = isDomainError
      ? error.httpStatus
      : error.statusCode || 500;
    const hideInternalDetails =
      process.env.NODE_ENV === "production" && statusCode >= 500;
    const clientMessage = isDomainError
      ? error.safeMessage
      : error.clientMessage || error.message;
    const applicationError = {
      code: isDomainError ? error.code : "INTERNAL_ERROR",
      statusCode,
      retryable: isDomainError ? error.retryable : false,
    };

    res.locals ||= {};
    res.locals.applicationError = applicationError;
    logger.log("application_error", {
      requestId: req.applicationContext?.requestId,
      correlationId: req.applicationContext?.correlationId,
      statusCode: applicationError.statusCode,
      errorCode: applicationError.code,
      retryable: applicationError.retryable,
    });

    return res.status(statusCode).json({
      message: hideInternalDetails
        ? "Internal server error"
        : clientMessage || "Internal server error",
    });
  };

const errorHandler = createErrorHandler();

module.exports = errorHandler;
module.exports.createErrorHandler = createErrorHandler;
