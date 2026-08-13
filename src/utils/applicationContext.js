const ACTOR_TYPES = Object.freeze({
  USER: "user",
  SERVICE: "service",
});

const CONTEXT_SOURCES = Object.freeze({
  HTTP_API: "http-api",
  INTERNAL: "internal",
});

const CONTEXT_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_CONTEXT_ID_LENGTH = 128;
const SUPPORTED_CONTEXT_PAIRS = Object.freeze([
  `${CONTEXT_SOURCES.HTTP_API}/${ACTOR_TYPES.USER}`,
  `${CONTEXT_SOURCES.INTERNAL}/${ACTOR_TYPES.SERVICE}`,
]);

const supportedPairSet = new Set(SUPPORTED_CONTEXT_PAIRS);
const CONTEXT_KEYS = Object.freeze([
  "requestId",
  "correlationId",
  "causationId",
  "source",
  "actor",
]);
const ACTOR_KEYS = Object.freeze(["type", "id"]);

const isPlainRecord = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const hasExactDataProperties = (value, expectedKeys) => {
  if (!isPlainRecord(value)) return false;

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    return false;
  }

  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      !Object.prototype.hasOwnProperty.call(descriptor, "get") &&
      !Object.prototype.hasOwnProperty.call(descriptor, "set")
    );
  });
};

const isValidContextId = (value) =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= MAX_CONTEXT_ID_LENGTH &&
  CONTEXT_ID_PATTERN.test(value);

const isSupportedContextPair = (source, actorType) =>
  supportedPairSet.has(`${source}/${actorType}`);

const isValidApplicationContext = (context) => {
  try {
    if (!hasExactDataProperties(context, CONTEXT_KEYS)) return false;
    if (!hasExactDataProperties(context.actor, ACTOR_KEYS)) return false;
    if (
      !isValidContextId(context.requestId) ||
      !isValidContextId(context.correlationId) ||
      !isValidContextId(context.causationId) ||
      !isValidContextId(context.actor.id)
    ) {
      return false;
    }
    if (context.causationId !== context.requestId) return false;
    return isSupportedContextPair(context.source, context.actor.type);
  } catch (_error) {
    return false;
  }
};

const assertApplicationContext = (context) => {
  if (!isValidApplicationContext(context)) {
    throw new TypeError("Invalid application context");
  }
  return context;
};

module.exports = {
  ACTOR_TYPES,
  CONTEXT_ID_PATTERN,
  CONTEXT_SOURCES,
  MAX_CONTEXT_ID_LENGTH,
  SUPPORTED_CONTEXT_PAIRS,
  assertApplicationContext,
  isSupportedContextPair,
  isValidApplicationContext,
  isValidContextId,
};
