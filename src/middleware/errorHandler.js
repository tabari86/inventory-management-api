const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const {
  FAILURE_CLASSES,
  logger: defaultLogger,
} = require("../config/logger");
const errorCodes = require("../errors/errorCodes");
const { sendError } = require("../http/contract");

const MAX_ERROR_CAUSE_DEPTH = 5;
const DATABASE_OPERATIONAL_ERROR_TYPES = Object.freeze([
  mongoose.mongo.MongoClientClosedError,
  mongoose.mongo.MongoNetworkError,
  mongoose.mongo.MongoNotConnectedError,
  mongoose.mongo.MongoOperationTimeoutError,
  mongoose.mongo.MongoServerClosedError,
  mongoose.mongo.MongoServerSelectionError,
  mongoose.mongo.MongoTopologyClosedError,
]);

const classifyInternalFailure = (error, code) => {
  if (code !== errorCodes.INTERNAL_ERROR) return undefined;

  const seen = new Set();
  let current = error;
  for (
    let depth = 0;
    current instanceof Error &&
    depth < MAX_ERROR_CAUSE_DEPTH &&
    !seen.has(current);
    depth += 1
  ) {
    if (
      DATABASE_OPERATIONAL_ERROR_TYPES.some(
        (ErrorType) => current instanceof ErrorType
      )
    ) {
      return FAILURE_CLASSES.DATABASE;
    }
    seen.add(current);
    try {
      current = current.cause;
    } catch (_causeAccessError) {
      break;
    }
  }

  return FAILURE_CLASSES.APPLICATION;
};

const createErrorHandler = (logger = defaultLogger) =>
  function errorHandler(error, req, res, _next) {
    const malformedJson =
      error instanceof SyntaxError && error.status === 400 && "body" in error;
    const isDomainError = error instanceof DomainError;
    const statusCode = malformedJson
      ? 400
      : isDomainError
        ? error.httpStatus
        : error.statusCode || 500;
    const hideInternalDetails =
      process.env.NODE_ENV === "production" && statusCode >= 500;
    const clientMessage = isDomainError
      ? error.safeMessage
      : error.clientMessage || error.message;
    const code = malformedJson
      ? errorCodes.VALIDATION_FAILED
      : isDomainError
        ? error.code
        : errorCodes.INTERNAL_ERROR;
    const applicationError = {
      code,
      statusCode,
      retryable: isDomainError ? error.retryable : false,
    };
    const failureClass = classifyInternalFailure(error, applicationError.code);

    res.locals ||= {};
    res.locals.applicationError = applicationError;
    logger.log("application_error", {
      requestId: req.applicationContext?.requestId,
      correlationId: req.applicationContext?.correlationId,
      statusCode: applicationError.statusCode,
      errorCode: applicationError.code,
      retryable: applicationError.retryable,
      ...(failureClass ? { failureClass } : {}),
    });

    const legacyMessage = hideInternalDetails
      ? "Internal server error"
      : clientMessage || "Internal server error";
    const detail = malformedJson
      ? "Malformed JSON request body"
      : statusCode >= 500
        ? "An unexpected error occurred"
        : clientMessage || "Request failed";

    return sendError(req, res, {
      statusCode,
      code,
      title: error.title,
      detail,
      retryable: applicationError.retryable,
      errors: error.errors,
      legacyMessage,
    });
  };

const errorHandler = createErrorHandler();

module.exports = errorHandler;
module.exports.createErrorHandler = createErrorHandler;
