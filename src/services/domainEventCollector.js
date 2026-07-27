const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const { normalizePlainJson } = require("../utils/boundedJson");

const AGGREGATE_TYPES = new Set(["Product", "Warehouse", "Stock"]);
const REASON_CODE_PATTERN = /^[A-Z0-9_:-]+$/;

const invalidDescriptor = (message, cause) =>
  new DomainError({
    code: errorCodes.EVENT_DESCRIPTOR_INVALID,
    httpStatus: 500,
    message,
    safeMessage: "Could not complete request",
    retryable: false,
    cause,
  });

const validateCommon = (descriptor) => {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw invalidDescriptor("Event descriptor must be an object");
  }
  if (!AGGREGATE_TYPES.has(descriptor.aggregateType)) {
    throw invalidDescriptor("Event descriptor has an invalid aggregate type");
  }
  if (
    typeof descriptor.aggregateId !== "string" ||
    descriptor.aggregateId.length < 1 ||
    descriptor.aggregateId.length > 128
  ) {
    throw invalidDescriptor("Event descriptor has an invalid aggregate ID");
  }
  if (
    !Number.isInteger(descriptor.aggregateVersion) ||
    descriptor.aggregateVersion < 1
  ) {
    throw invalidDescriptor("Event descriptor has an invalid aggregate version");
  }
  if (
    typeof descriptor.occurredAt !== "string" ||
    Number.isNaN(Date.parse(descriptor.occurredAt))
  ) {
    throw invalidDescriptor("Event descriptor has an invalid occurrence time");
  }
  if (
    descriptor.reasonCode !== null &&
    descriptor.reasonCode !== undefined &&
    (typeof descriptor.reasonCode !== "string" ||
      descriptor.reasonCode.length > 128 ||
      !REASON_CODE_PATTERN.test(descriptor.reasonCode))
  ) {
    throw invalidDescriptor("Event descriptor has an invalid reason code");
  }
};

const normalizeDescriptor = (descriptor) => {
  try {
    return normalizePlainJson(descriptor);
  } catch (cause) {
    if (cause instanceof DomainError) throw cause;
    throw invalidDescriptor("Event descriptor is not plain JSON", cause);
  }
};

const createDomainEventCollector = ({ clock = () => new Date() } = {}) => {
  const descriptors = [];

  const recordChange = (input) => {
    const descriptor = normalizeDescriptor({
      kind: "changed",
      eventType: input?.eventType,
      aggregateType: input?.aggregateType,
      aggregateId: String(input?.aggregateId || "").toLowerCase(),
      aggregateVersion: input?.aggregateVersion,
      before: input?.before ?? null,
      after: input?.after ?? null,
      payload: input?.payload,
      reasonCode: input?.reasonCode ?? null,
      metadata: input?.metadata ?? {},
      occurredAt: input?.occurredAt || new Date(clock()).toISOString(),
    });
    validateCommon(descriptor);
    if (typeof descriptor.eventType !== "string" || !descriptor.eventType) {
      throw invalidDescriptor("Changed event descriptor requires an event type");
    }
    if (!descriptor.payload || Array.isArray(descriptor.payload)) {
      throw invalidDescriptor("Changed event descriptor requires a payload object");
    }
    if (!descriptor.after || Array.isArray(descriptor.after)) {
      throw invalidDescriptor("Changed event descriptor requires an after snapshot");
    }
    descriptors.push(descriptor);
  };

  const recordNoChange = (input) => {
    const descriptor = normalizeDescriptor({
      kind: "no_change",
      aggregateType: input?.aggregateType,
      aggregateId: String(input?.aggregateId || "").toLowerCase(),
      aggregateVersion: input?.aggregateVersion,
      before: input?.before ?? null,
      after: input?.after ?? null,
      reasonCode: input?.reasonCode || "NO_STATE_CHANGE",
      metadata: input?.metadata ?? {},
      occurredAt: input?.occurredAt || new Date(clock()).toISOString(),
    });
    validateCommon(descriptor);
    if (!descriptor.before || !descriptor.after) {
      throw invalidDescriptor("No-change descriptor requires before and after snapshots");
    }
    descriptors.push(descriptor);
  };

  return Object.freeze({
    recordChange,
    recordNoChange,
    descriptors: () => descriptors.map((descriptor) => normalizePlainJson(descriptor)),
  });
};

module.exports = {
  AGGREGATE_TYPES,
  createDomainEventCollector,
  invalidDescriptor,
};
