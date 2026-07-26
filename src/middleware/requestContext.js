const { randomUUID } = require("crypto");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const getSingleHeader = require("../utils/singleHeader");

const CONTEXT_SOURCE = "http-api";
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

const isValidCorrelationId = (header) =>
  header.validCardinality &&
  typeof header.value === "string" &&
  header.value.length >= 1 &&
  header.value.length <= 128 &&
  !header.value.includes(",") &&
  CORRELATION_ID_PATTERN.test(header.value);

const requestContext = (req, res, next) => {
  const requestId = randomUUID();
  const correlationHeader = getSingleHeader(req, "x-correlation-id");
  let correlationId = requestId;

  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Correlation-ID", correlationId);

  req.applicationContext = {
    requestId,
    correlationId,
    source: CONTEXT_SOURCE,
  };

  if (correlationHeader.present) {
    if (!isValidCorrelationId(correlationHeader)) {
      return next(
        new DomainError({
          code: errorCodes.INVALID_CORRELATION_ID,
          httpStatus: 400,
          message: "Invalid X-Correlation-ID header",
          retryable: false,
        })
      );
    }

    correlationId = correlationHeader.value;
    req.applicationContext.correlationId = correlationId;
    res.setHeader("X-Correlation-ID", correlationId);
  }

  return next();
};

module.exports = {
  CONTEXT_SOURCE,
  CORRELATION_ID_PATTERN,
  isValidCorrelationId,
  requestContext,
};
