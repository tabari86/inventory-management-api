const mongoose = require("mongoose");

const { sha256 } = require("./idempotencyHash");

const REQUEST_HASH_VERSION = "canonical-json-v1";

const unsupportedValue = (description) =>
  new TypeError(`Unsupported canonical JSON value: ${description}`);

const canonicalize = (value) => {
  const activeObjects = new WeakSet();

  const visit = (current, inArray = false) => {
    if (current === null) return "null";

    const type = typeof current;

    if (type === "string" || type === "boolean") {
      return JSON.stringify(current);
    }

    if (type === "number") {
      if (!Number.isFinite(current)) throw unsupportedValue("non-finite number");
      return Object.is(current, -0) ? "0" : JSON.stringify(current);
    }

    if (type === "undefined") {
      if (inArray) throw unsupportedValue("undefined array entry");
      return undefined;
    }

    if (type === "function" || type === "symbol" || type === "bigint") {
      throw unsupportedValue(type);
    }

    if (current instanceof mongoose.Types.ObjectId) {
      return JSON.stringify(current.toHexString().toLowerCase());
    }

    if (current instanceof Date) {
      if (Number.isNaN(current.getTime())) throw unsupportedValue("invalid date");
      return JSON.stringify(current.toISOString());
    }

    if (activeObjects.has(current)) throw unsupportedValue("circular reference");

    if (Array.isArray(current)) {
      activeObjects.add(current);
      try {
        return `[${current.map((entry) => visit(entry, true)).join(",")}]`;
      } finally {
        activeObjects.delete(current);
      }
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw unsupportedValue("non-plain object");
    }

    activeObjects.add(current);
    try {
      const members = [];
      for (const key of Object.keys(current).sort()) {
        const serializedValue = visit(current[key], false);
        if (serializedValue !== undefined) {
          members.push(`${JSON.stringify(key)}:${serializedValue}`);
        }
      }
      return `{${members.join(",")}}`;
    } finally {
      activeObjects.delete(current);
    }
  };

  return visit(value);
};

const hashCanonicalCommand = (command) => {
  const canonicalJson = canonicalize(command);
  if (canonicalJson === undefined) throw unsupportedValue("undefined root");

  return {
    canonicalJson,
    requestHash: sha256(canonicalJson),
    requestHashVersion: REQUEST_HASH_VERSION,
  };
};

const buildCanonicalCommand = ({
  operationId,
  pathParameters = {},
  semanticQueryParameters = {},
  normalizedBody,
}) => ({
  operationId,
  pathParameters,
  semanticQueryParameters,
  normalizedBody,
});

module.exports = {
  REQUEST_HASH_VERSION,
  buildCanonicalCommand,
  canonicalize,
  hashCanonicalCommand,
};
