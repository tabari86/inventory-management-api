const errorCodes = require("../errors/errorCodes");

const API_CONTRACT_LEGACY = "legacy";
const API_CONTRACT_V1 = "v1";
const API_SCHEMA_VERSION = "1.0";
const MAX_ERROR_DETAILS = 50;

const ERROR_TITLES = Object.freeze({
  [errorCodes.AUTHENTICATION_REQUIRED]: "Authentication required",
  [errorCodes.AUTHENTICATION_FAILED]: "Authentication failed",
  [errorCodes.INVALID_ACCESS_TOKEN]: "Invalid access token",
  [errorCodes.INVALID_REFRESH_TOKEN]: "Invalid refresh token",
  [errorCodes.ACCESS_DENIED]: "Access denied",
  [errorCodes.RATE_LIMITED]: "Rate limit exceeded",
  [errorCodes.VALIDATION_FAILED]: "Validation failed",
  [errorCodes.INVALID_CURSOR]: "Invalid cursor",
  [errorCodes.RESOURCE_NOT_FOUND]: "Resource not found",
  [errorCodes.DUPLICATE_RESOURCE]: "Duplicate resource",
  [errorCodes.INSUFFICIENT_STOCK]: "Insufficient stock",
  [errorCodes.INVALID_RESOURCE_STATE]: "Invalid resource state",
  [errorCodes.INACTIVE_PRODUCT]: "Inactive product",
  [errorCodes.INACTIVE_WAREHOUSE]: "Inactive warehouse",
  [errorCodes.INACTIVE_STOCK]: "Inactive stock",
  [errorCodes.STALE_VERSION]: "Version conflict",
  [errorCodes.INVALID_CORRELATION_ID]: "Invalid correlation ID",
  [errorCodes.INVALID_IDEMPOTENCY_KEY]: "Invalid idempotency key",
  [errorCodes.IDEMPOTENCY_CONFLICT]: "Idempotency conflict",
  [errorCodes.IDEMPOTENCY_IN_PROGRESS]: "Request in progress",
  [errorCodes.IDEMPOTENCY_RESPONSE_TOO_LARGE]: "Response too large",
  [errorCodes.DEPENDENCY_UNAVAILABLE]: "Dependency unavailable",
  [errorCodes.TRANSACTION_FAILED]: "Transaction failed",
  [errorCodes.AUDIT_SNAPSHOT_TOO_LARGE]: "Audit snapshot too large",
  [errorCodes.AUDIT_METADATA_TOO_LARGE]: "Audit metadata too large",
  [errorCodes.OUTBOX_PAYLOAD_TOO_LARGE]: "Outbox payload too large",
  [errorCodes.EVENT_SERIALIZATION_FAILED]: "Event serialization failed",
  [errorCodes.EVENT_DESCRIPTOR_INVALID]: "Event descriptor invalid",
  [errorCodes.INTERNAL_ERROR]: "Internal server error",
});

const setApiContractVersion = (version) => {
  if (![API_CONTRACT_LEGACY, API_CONTRACT_V1].includes(version)) {
    throw new TypeError("Unsupported API contract version");
  }

  return function apiContractVersion(req, _res, next) {
    req.apiContractVersion = version;
    next();
  };
};

const isV1Request = (req) => req.apiContractVersion === API_CONTRACT_V1;

const requestMeta = (req) => ({
  requestId: req.applicationContext?.requestId,
  correlationId: req.applicationContext?.correlationId,
  schemaVersion: API_SCHEMA_VERSION,
});

const buildV1SuccessEnvelope = (req, data, pagination) => ({
  data: data === undefined ? null : data,
  meta: {
    ...requestMeta(req),
    ...(pagination
      ? {
          limit: pagination.limit,
          nextCursor: pagination.nextCursor,
        }
      : {}),
  },
});

const normalizeErrorDetails = (errors) =>
  (Array.isArray(errors) ? errors : [])
    .slice(0, MAX_ERROR_DETAILS)
    .map(({ field, message }) => ({
      field: String(field || "request").slice(0, 128),
      message: String(message || "Invalid value").slice(0, 512),
    }));

const buildV1ErrorEnvelope = (
  req,
  { statusCode, code, title, detail, retryable = false, errors = [] }
) => ({
  type: "inventory-error",
  title: title || ERROR_TITLES[code] || "Request failed",
  status: statusCode,
  code,
  detail,
  requestId: req.applicationContext?.requestId,
  correlationId: req.applicationContext?.correlationId,
  retryable: Boolean(retryable),
  errors: normalizeErrorDetails(errors),
});

const markApplicationError = (res, { statusCode, code, retryable }) => {
  res.locals ||= {};
  res.locals.applicationError = {
    statusCode,
    code,
    retryable: Boolean(retryable),
  };
};

const sendSuccess = (
  req,
  res,
  { statusCode = 200, message, data }
) => {
  if (isV1Request(req)) {
    return res.status(statusCode).json(buildV1SuccessEnvelope(req, data));
  }

  const body = { message };
  if (data !== undefined) body.data = data;
  return res.status(statusCode).json(body);
};

const sendPaginatedResult = (
  req,
  res,
  { statusCode = 200, message, items, limit, nextCursor }
) => {
  if (isV1Request(req)) {
    return res
      .status(statusCode)
      .json(buildV1SuccessEnvelope(req, items, { limit, nextCursor }));
  }

  if (nextCursor) res.setHeader("X-Next-Cursor", nextCursor);
  return res.status(statusCode).json({ message, data: items });
};

const sendError = (
  req,
  res,
  {
    statusCode,
    code,
    title,
    detail,
    retryable = false,
    errors = [],
    legacyMessage = detail,
  }
) => {
  markApplicationError(res, { statusCode, code, retryable });

  if (isV1Request(req)) {
    return res.status(statusCode).json(
      buildV1ErrorEnvelope(req, {
        statusCode,
        code,
        title,
        detail,
        retryable,
        errors,
      })
    );
  }

  const body = { message: legacyMessage };
  const boundedErrors = normalizeErrorDetails(errors);
  if (boundedErrors.length > 0) body.errors = boundedErrors;
  return res.status(statusCode).json(body);
};

module.exports = {
  API_CONTRACT_LEGACY,
  API_CONTRACT_V1,
  API_SCHEMA_VERSION,
  ERROR_TITLES,
  MAX_ERROR_DETAILS,
  buildV1ErrorEnvelope,
  buildV1SuccessEnvelope,
  isV1Request,
  sendError,
  sendPaginatedResult,
  sendSuccess,
  setApiContractVersion,
};
