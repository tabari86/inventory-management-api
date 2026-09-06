const pino = require("pino");

const SERVICE_NAME = "inventory-management-api";
const FAILURE_CLASSES = Object.freeze({
  APPLICATION: "APPLICATION",
  DATABASE: "DATABASE",
});
const SAFE_FAILURE_CLASSES = Object.freeze(Object.values(FAILURE_CLASSES));
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const SAFE_METHOD_PATTERN = /^[A-Z]{1,16}$/;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._~!$&'()*+,;=:@%\-/{}]{1,256}$/;
const SAFE_SIGNAL_PATTERN = /^SIG(?:TERM|INT)$/;

const EVENT_DEFINITIONS = Object.freeze({
  application_starting: {
    level: "info",
    message: "Application startup started",
    fields: ["port"],
  },
  database_connected: {
    level: "info",
    message: "Database connection established",
    fields: ["attempt"],
  },
  database_connection_attempt_failed: {
    level: "warn",
    message: "Database connection attempt failed",
    fields: ["attempt", "maxAttempts", "retrying"],
  },
  application_listening: {
    level: "info",
    message: "HTTP server is listening",
    fields: ["port"],
  },
  application_ready: {
    level: "info",
    message: "Application is ready",
    fields: ["port"],
  },
  application_startup_failed: {
    level: "error",
    message: "Application startup failed",
    fields: ["exitCode", "errorCode"],
  },
  application_shutdown_started: {
    level: "info",
    message: "Application shutdown started",
    fields: ["signal", "timeoutMs"],
  },
  application_shutdown_completed: {
    level: "info",
    message: "Application shutdown completed",
    fields: ["signal", "exitCode"],
  },
  application_shutdown_timeout: {
    level: "error",
    message: "Application shutdown timed out",
    fields: ["signal", "timeoutMs", "exitCode"],
  },
  application_shutdown_failed: {
    level: "error",
    message: "Application shutdown failed",
    fields: ["signal", "exitCode", "errorCode"],
  },
  http_request_completed: {
    level: "info",
    message: "HTTP request completed",
    fields: [
      "requestId",
      "correlationId",
      "method",
      "path",
      "statusCode",
      "durationMs",
      "actor",
      "errorCode",
      "retryable",
      "idempotencyKeyPresent",
    ],
  },
  http_request_aborted: {
    level: "warn",
    message: "HTTP request aborted",
    fields: [
      "requestId",
      "correlationId",
      "method",
      "path",
      "durationMs",
      "actor",
      "idempotencyKeyPresent",
    ],
  },
  application_error: {
    level: "error",
    message: "Application request failed",
    fields: [
      "requestId",
      "correlationId",
      "statusCode",
      "errorCode",
      "retryable",
      "failureClass",
    ],
  },
});

const SENSITIVE_FIELD_NAMES = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "passwordHash",
  "accessToken",
  "refreshToken",
  "token",
  "jwt",
  "secret",
  "clientSecret",
  "MONGODB_URI",
  "mongodbUri",
  "idempotencyKey",
  "Idempotency-Key",
  "requestBody",
  "responseBody",
  "headers",
];

const redactionPaths = SENSITIVE_FIELD_NAMES.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
  `*.*.*.${field}`,
]);

const normalizeEnvironment = (environment) =>
  ["production", "development", "test"].includes(environment)
    ? environment
    : "unknown";

const finiteNonNegative = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

const nonNegativeInteger = (value) =>
  Number.isInteger(value) && value >= 0 ? value : undefined;

const safeString = (value, pattern) =>
  typeof value === "string" && pattern.test(value) ? value : undefined;

const sanitizeActor = (actor) => {
  if (!actor || actor.type !== "user") return undefined;
  const id = safeString(String(actor.id || ""), SAFE_ID_PATTERN);
  return id ? { type: "user", id } : undefined;
};

const sanitizeField = (field, value) => {
  switch (field) {
    case "requestId":
    case "correlationId":
      return safeString(value, SAFE_ID_PATTERN);
    case "method":
      return safeString(value, SAFE_METHOD_PATTERN);
    case "path":
      return safeString(value, SAFE_PATH_PATTERN);
    case "signal":
      return safeString(value, SAFE_SIGNAL_PATTERN);
    case "errorCode":
      return safeString(value, SAFE_CODE_PATTERN);
    case "failureClass":
      return SAFE_FAILURE_CLASSES.includes(value) ? value : undefined;
    case "port":
    case "statusCode":
    case "attempt":
    case "maxAttempts":
    case "timeoutMs":
    case "exitCode":
      return nonNegativeInteger(value);
    case "durationMs":
      return finiteNonNegative(value);
    case "retrying":
    case "retryable":
    case "idempotencyKeyPresent":
      return typeof value === "boolean" ? value : undefined;
    case "actor":
      return sanitizeActor(value);
    default:
      return undefined;
  }
};

const sanitizeEventFields = (event, fields = {}) => {
  const definition = EVENT_DEFINITIONS[event];
  if (!definition || !fields || typeof fields !== "object") return {};

  const sanitized = {};
  for (const field of definition.fields) {
    const value = sanitizeField(field, fields[field]);
    if (value !== undefined) sanitized[field] = value;
  }
  return sanitized;
};

const createLogger = ({
  destination,
  environment = process.env.NODE_ENV,
  level = environment === "test" ? "silent" : "info",
} = {}) => {
  const output =
    destination ||
    pino.destination({
      dest: 1,
      sync: true,
    });
  const instance = pino(
    {
      level,
      base: {
        service: SERVICE_NAME,
        environment: normalizeEnvironment(environment),
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      redact: {
        paths: redactionPaths,
        censor: "[REDACTED]",
      },
    },
    output
  );

  return {
    log(event, fields = {}) {
      const definition = EVENT_DEFINITIONS[event];
      if (!definition) return false;
      instance[definition.level](
        {
          event,
          ...sanitizeEventFields(event, fields),
        },
        definition.message
      );
      return true;
    },
    flush() {
      instance.flush();
    },
  };
};

const logger = createLogger();

module.exports = {
  EVENT_DEFINITIONS,
  FAILURE_CLASSES,
  SERVICE_NAME,
  createLogger,
  logger,
  redactionPaths,
  sanitizeEventFields,
};
