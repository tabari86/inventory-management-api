const { randomUUID } = require("crypto");

const getSingleHeader = require("../utils/singleHeader");
const {
  CONTEXT_ID_PATTERN,
  CONTEXT_SOURCES,
  MAX_CONTEXT_ID_LENGTH,
  isValidContextId: isValidApplicationContextId,
} = require("../utils/applicationContext");

const CONTEXT_SOURCE = CONTEXT_SOURCES.HTTP_API;

const isValidContextId = (header) =>
  header.validCardinality &&
  isValidApplicationContextId(header.value) &&
  !header.value.includes(",");

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
