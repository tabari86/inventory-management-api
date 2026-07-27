const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const { canonicalize } = require("./canonicalJson");

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const serializationError = (message, cause) =>
  new DomainError({
    code: errorCodes.EVENT_SERIALIZATION_FAILED,
    httpStatus: 500,
    message,
    safeMessage: "Could not complete request",
    retryable: false,
    cause,
  });

const normalizePlainJson = (input) => {
  const activeObjects = new WeakSet();

  const visit = (value, inArray = false) => {
    if (value === null) return null;

    const type = typeof value;
    if (type === "string" || type === "boolean") return value;
    if (type === "number") {
      if (!Number.isFinite(value)) {
        throw serializationError("Event data contains a non-finite number");
      }
      return Object.is(value, -0) ? 0 : value;
    }
    if (type === "undefined") {
      if (inArray) {
        throw serializationError("Event data contains an undefined array entry");
      }
      return undefined;
    }
    if (type === "function" || type === "symbol" || type === "bigint") {
      throw serializationError(`Event data contains unsupported ${type}`);
    }

    if (value instanceof mongoose.Types.ObjectId) {
      return value.toHexString().toLowerCase();
    }
    if (value instanceof Date) {
      throw serializationError(
        "Event Date values must be intentionally converted to ISO strings"
      );
    }
    if (value instanceof Error) {
      throw serializationError("Event data cannot contain Error objects");
    }
    if (value instanceof mongoose.Document) {
      throw serializationError("Event data cannot contain Mongoose documents");
    }
    if (activeObjects.has(value)) {
      throw serializationError("Event data contains a circular reference");
    }

    if (Array.isArray(value)) {
      activeObjects.add(value);
      try {
        return value.map((entry) => visit(entry, true));
      } finally {
        activeObjects.delete(value);
      }
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw serializationError("Event data must contain only plain objects");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw serializationError("Event data cannot contain symbol keys");
    }

    activeObjects.add(value);
    try {
      const normalized = {};
      for (const key of Object.keys(value)) {
        if (UNSAFE_KEYS.has(key)) {
          throw serializationError(`Event data contains unsafe key ${key}`);
        }
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (property?.get || property?.set) {
          throw serializationError("Event data cannot contain accessor properties");
        }
        const child = visit(property.value, false);
        if (child !== undefined) normalized[key] = child;
      }
      return normalized;
    } finally {
      activeObjects.delete(value);
    }
  };

  try {
    return visit(input);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw serializationError("Could not serialize event data", error);
  }
};

const serializeBoundedJson = ({
  value,
  maxBytes,
  tooLargeCode,
  tooLargeMessage,
  requireObject = true,
}) => {
  const normalized = normalizePlainJson(value);
  if (
    requireObject &&
    (normalized === null || Array.isArray(normalized) || typeof normalized !== "object")
  ) {
    throw serializationError("Event data root must be a plain object");
  }

  let serialized;
  try {
    serialized = canonicalize(normalized);
  } catch (cause) {
    throw serializationError("Could not serialize event data", cause);
  }

  if (serialized === undefined) {
    throw serializationError("Event data root cannot be undefined");
  }

  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  if (sizeBytes > maxBytes) {
    throw new DomainError({
      code: tooLargeCode,
      httpStatus: 500,
      message: tooLargeMessage,
      safeMessage: "Could not complete request",
      retryable: false,
    });
  }

  return { value: normalized, serialized, sizeBytes };
};

module.exports = {
  UNSAFE_KEYS,
  normalizePlainJson,
  serializeBoundedJson,
};
