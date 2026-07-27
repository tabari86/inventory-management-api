const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const { normalizePlainJson } = require("../utils/boundedJson");
const { snapshotBuilders } = require("./eventSnapshots");

const EVENT_VERSION = 1;
const PAYLOAD_SCHEMA_VERSION = 1;
const MAX_OUTBOX_PAYLOAD_BYTES = 65_536;

const invalid = (message, cause) =>
  new DomainError({
    code: errorCodes.EVENT_DESCRIPTOR_INVALID,
    httpStatus: 500,
    message,
    safeMessage: "Could not complete request",
    retryable: false,
    cause,
  });

const assertPayloadContract = ({ payload, required, optional = [] }) => {
  let normalized;
  try {
    normalized = normalizePlainJson(payload);
  } catch (cause) {
    throw invalid("Event payload is not safe plain JSON", cause);
  }
  if (!normalized || Array.isArray(normalized)) {
    throw invalid("Event payload must be an object");
  }

  const allowed = new Set([...required, ...optional]);
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) {
      throw invalid(`Event payload is missing required field ${field}`);
    }
  }
  for (const field of Object.keys(normalized)) {
    if (!allowed.has(field)) {
      throw invalid(`Event payload contains unsupported field ${field}`);
    }
  }
  return normalized;
};

const validatePayloadFacts = (payload) => {
  for (const [field, value] of Object.entries(payload)) {
    if (
      field.endsWith("Id") &&
      (typeof value !== "string" || !value || value.length > 128)
    ) {
      throw invalid(`Event payload field ${field} must be a canonical ID`);
    }
  }
  if (
    !Number.isInteger(payload.aggregateVersion) ||
    payload.aggregateVersion < 1
  ) {
    throw invalid("Event payload aggregateVersion must be a positive integer");
  }
  if (
    payload.changedFields !== undefined &&
    (!Array.isArray(payload.changedFields) ||
      payload.changedFields.length < 1 ||
      payload.changedFields.length > 32 ||
      payload.changedFields.some(
        (field) => typeof field !== "string" || field.length > 64
      ) ||
      new Set(payload.changedFields).size !== payload.changedFields.length ||
      [...payload.changedFields].sort().join("\0") !==
        payload.changedFields.join("\0"))
  ) {
    throw invalid("Event payload changedFields must be unique and deterministic");
  }
  if (
    payload.linkedStockIds !== undefined &&
    (!Array.isArray(payload.linkedStockIds) ||
      payload.linkedStockIds.length > 150 ||
      payload.linkedStockIds.some(
        (id) => typeof id !== "string" || !id || id.length > 128
      ) ||
      new Set(payload.linkedStockIds).size !== payload.linkedStockIds.length ||
      [...payload.linkedStockIds].sort().join("\0") !==
        payload.linkedStockIds.join("\0"))
  ) {
    throw invalid("Event payload linkedStockIds must contain canonical IDs");
  }
  if (
    payload.linkedCount !== undefined &&
    (!Number.isInteger(payload.linkedCount) ||
      payload.linkedCount < 1 ||
      payload.linkedCount !== payload.linkedStockIds?.length)
  ) {
    throw invalid("Event payload linkedCount must match linkedStockIds");
  }
  for (const [field, maxLength] of [
    ["sku", 64],
    ["code", 64],
    ["reference", 100],
    ["reasonCode", 128],
    ["archiveReason", 500],
  ]) {
    const value = payload[field];
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== "string" ||
        value.length > maxLength ||
        (["sku", "code"].includes(field) &&
          (!value || value !== value.trim())))
    ) {
      throw invalid(`Event payload field ${field} is invalid`);
    }
  }
  for (const field of ["status", "previousStatus"]) {
    if (
      payload[field] !== undefined &&
      !["active", "inactive"].includes(payload[field])
    ) {
      throw invalid(`Event payload field ${field} is invalid`);
    }
  }
  for (const field of ["quantity", "beforeQuantity", "afterQuantity"]) {
    if (
      payload[field] !== undefined &&
      (!Number.isInteger(payload[field]) || payload[field] < 0)
    ) {
      throw invalid(`Event payload field ${field} must be a non-negative integer`);
    }
  }
  for (const field of ["beforeGuard", "afterGuard"]) {
    if (payload[field] === undefined) continue;
    const guard = payload[field];
    if (
      !guard ||
      Array.isArray(guard) ||
      Object.keys(guard).sort().join(",") !==
        "productLifecycleStatus,status,warehouseLifecycleStatus" ||
      !["active", "inactive"].includes(guard.status) ||
      !["active", "inactive", "archived"].includes(
        guard.productLifecycleStatus
      ) ||
      !["active", "inactive"].includes(guard.warehouseLifecycleStatus)
    ) {
      throw invalid(`Event payload field ${field} is invalid`);
    }
  }
  return payload;
};

const contractBuilder = (required, optional = [], validate) => (payload) => {
  const normalized = assertPayloadContract({ payload, required, optional });
  validatePayloadFacts(normalized);
  if (validate) validate(normalized);
  return normalized;
};

const assertLifecycleTransition = ({
  payload,
  previousStatus,
  status,
  reasonCode,
}) => {
  if (
    payload.previousStatus !== previousStatus ||
    payload.status !== status ||
    (reasonCode !== undefined && payload.reasonCode !== reasonCode)
  ) {
    throw invalid("Event payload lifecycle transition is invalid");
  }
};

const assertMovementTransition = ({ payload, receipt }) => {
  const expectedReasonCode = receipt ? "GOODS_RECEIPT" : "GOODS_ISSUE";
  if (
    !Number.isInteger(payload.signedDelta) ||
    (receipt ? payload.signedDelta <= 0 : payload.signedDelta >= 0) ||
    payload.reasonCode !== expectedReasonCode ||
    payload.afterQuantity !== payload.beforeQuantity + payload.signedDelta
  ) {
    throw invalid("Event payload movement transition is invalid");
  }
};

const definitions = [
  ["catalog.product.created", "Product", ["productId", "sku", "status", "aggregateVersion"]],
  ["catalog.product.updated", "Product", ["productId", "sku", "changedFields", "aggregateVersion"]],
  [
    "catalog.product.reactivated",
    "Product",
    ["productId", "sku", "previousStatus", "status", "aggregateVersion"],
    (payload) =>
      assertLifecycleTransition({
        payload,
        previousStatus: "inactive",
        status: "active",
      }),
  ],
  [
    "catalog.product.deactivated",
    "Product",
    ["productId", "sku", "previousStatus", "status", "reasonCode", "aggregateVersion"],
    (payload) =>
      assertLifecycleTransition({
        payload,
        previousStatus: "active",
        status: "inactive",
        reasonCode: "PRODUCT_DEACTIVATED",
      }),
  ],
  [
    "catalog.product.archived",
    "Product",
    ["productId", "sku", "status", "archiveReason", "aggregateVersion"],
    (payload) => {
      if (payload.status !== "inactive") {
        throw invalid("Archived Product event requires inactive status");
      }
    },
  ],
  ["catalog.product.stock-linked", "Product", ["productId", "sku", "linkedStockIds", "linkedCount", "aggregateVersion"]],
  ["warehouse.created", "Warehouse", ["warehouseId", "code", "status", "aggregateVersion"]],
  ["warehouse.updated", "Warehouse", ["warehouseId", "code", "changedFields", "aggregateVersion"]],
  [
    "warehouse.reactivated",
    "Warehouse",
    ["warehouseId", "code", "previousStatus", "status", "aggregateVersion"],
    (payload) =>
      assertLifecycleTransition({
        payload,
        previousStatus: "inactive",
        status: "active",
      }),
  ],
  [
    "warehouse.deactivated",
    "Warehouse",
    ["warehouseId", "code", "previousStatus", "status", "reasonCode", "aggregateVersion"],
    (payload) =>
      assertLifecycleTransition({
        payload,
        previousStatus: "active",
        status: "inactive",
        reasonCode: "WAREHOUSE_DEACTIVATED",
      }),
  ],
  ["warehouse.stock-linked", "Warehouse", ["warehouseId", "code", "linkedStockIds", "linkedCount", "aggregateVersion"]],
  [
    "inventory.stock.created",
    "Stock",
    ["stockId", "productId", "warehouseId", "quantity", "aggregateVersion"],
    (payload) => {
      if (payload.quantity !== 0) {
        throw invalid("Created Stock event requires zero initial quantity");
      }
    },
  ],
  [
    "inventory.stock.received",
    "Stock",
    [
      "stockId",
      "productId",
      "warehouseId",
      "stockMovementId",
      "signedDelta",
      "beforeQuantity",
      "afterQuantity",
      "reference",
      "reasonCode",
      "aggregateVersion",
    ],
    (payload) => assertMovementTransition({ payload, receipt: true }),
  ],
  [
    "inventory.stock.issued",
    "Stock",
    [
      "stockId",
      "productId",
      "warehouseId",
      "stockMovementId",
      "signedDelta",
      "beforeQuantity",
      "afterQuantity",
      "reference",
      "reasonCode",
      "aggregateVersion",
    ],
    (payload) => assertMovementTransition({ payload, receipt: false }),
  ],
  [
    "inventory.stock.availability-guard-changed",
    "Stock",
    [
      "stockId",
      "productId",
      "warehouseId",
      "beforeGuard",
      "afterGuard",
      "cause",
      "aggregateVersion",
    ],
    (payload) => {
      const causeFields = Object.keys(payload.cause || {}).sort();
      if (
        !payload.cause ||
        causeFields.join(",") !==
          "aggregateId,aggregateType,aggregateVersion" ||
        !["Product", "Warehouse"].includes(payload.cause.aggregateType) ||
        typeof payload.cause.aggregateId !== "string" ||
        !payload.cause.aggregateId ||
        payload.cause.aggregateId.length > 128 ||
        !Number.isInteger(payload.cause.aggregateVersion) ||
        payload.cause.aggregateVersion < 1
      ) {
        throw invalid("Availability event requires a valid cause");
      }
      const changedGuardFields = Object.keys(payload.beforeGuard).filter(
        (field) => payload.beforeGuard[field] !== payload.afterGuard[field]
      );
      const expectedGuardField =
        payload.cause.aggregateType === "Product"
          ? "productLifecycleStatus"
          : "warehouseLifecycleStatus";
      if (
        changedGuardFields.length !== 1 ||
        changedGuardFields[0] !== expectedGuardField
      ) {
        throw invalid("Availability event guard transition is invalid");
      }
    },
  ],
];

const registry = new Map();
for (const [eventType, aggregateType, requiredPayloadFields, validate] of definitions) {
  if (registry.has(eventType)) throw new Error(`Duplicate event type ${eventType}`);
  registry.set(
    eventType,
    Object.freeze({
      eventType,
      eventVersion: EVENT_VERSION,
      payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
      aggregateType,
      requiredPayloadFields: Object.freeze([...requiredPayloadFields]),
      optionalPayloadFields: Object.freeze([]),
      maxPayloadBytes: MAX_OUTBOX_PAYLOAD_BYTES,
      snapshotBuilder: snapshotBuilders[aggregateType],
      payloadBuilder: contractBuilder(requiredPayloadFields, [], validate),
    })
  );
}

const getEventDefinition = (eventType) => {
  const definition = registry.get(eventType);
  if (!definition) throw invalid(`Unknown domain event type ${eventType}`);
  return definition;
};

const listEventDefinitions = () => [...registry.values()];

module.exports = {
  EVENT_VERSION,
  MAX_OUTBOX_PAYLOAD_BYTES,
  PAYLOAD_SCHEMA_VERSION,
  getEventDefinition,
  listEventDefinitions,
};
