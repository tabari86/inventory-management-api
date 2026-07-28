const { randomUUID } = require("crypto");

const getSingleHeader = require("../utils/singleHeader");

const CONTEXT_SOURCE = "http-api";
const CONTEXT_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_CONTEXT_ID_LENGTH = 128;

const isValidContextId = (header) =>
  header.validCardinality &&
  typeof header.value === "string" &&
  header.value.length >= 1 &&
  header.value.length <= MAX_CONTEXT_ID_LENGTH &&
  !header.value.includes(",") &&
  CONTEXT_ID_PATTERN.test(header.value);

const requestContext = (req, res, next) => {
  const requestHeader = getSingleHeader(req, "x-request-id");
  const correlationHeader = getSingleHeader(req, "x-correlation-id");
  const requestId = isValidContextId(requestHeader)
    ? requestHeader.value
    : randomUUID();
  const correlationId = isValidContextId(correlationHeader)
    ? correlationHeader.value
    : requestId;

  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Correlation-ID", correlationId);

  req.applicationContext = {
    requestId,
    correlationId,
    causationId: requestId,
    source: CONTEXT_SOURCE,
  };

  return next();
};

module.exports = {
  CONTEXT_SOURCE,
  CONTEXT_ID_PATTERN,
  MAX_CONTEXT_ID_LENGTH,
  isValidContextId,
  isValidCorrelationId: isValidContextId,
  requestContext,
};
