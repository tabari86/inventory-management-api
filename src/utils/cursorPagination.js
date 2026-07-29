const { createHash } = require("crypto");
const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Product = require("../models/Product");
const Warehouse = require("../models/Warehouse");
const { canonicalize } = require("./canonicalJson");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_CURSOR_LENGTH = 1024;
const CURSOR_VERSION = 1;
const SORT_FIELD = "createdAt";
const CURSOR_KEYS = Object.freeze(["v", "r", "s", "o", "t", "i", "q"]);
const COMMON_PARAMETERS = Object.freeze(["limit", "cursor", "sort", "order"]);
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const PRODUCT_SKU_MAX_LENGTH = Product.schema.path("sku").options.maxlength;
const WAREHOUSE_CODE_MAX_LENGTH = Warehouse.schema.path("code").options.maxlength;

const RESOURCE_FILTERS = Object.freeze({
  products: ["status", "sku"],
  warehouses: ["status", "code"],
  stocks: ["productId", "warehouseId", "status"],
  "stock-movements": [
    "stockId",
    "productId",
    "warehouseId",
    "type",
    "reference",
    "from",
    "to",
  ],
});

const validationFailure = (errors, legacyMessage = "Validation failed") =>
  new DomainError({
    code: errorCodes.VALIDATION_FAILED,
    httpStatus: 400,
    message: legacyMessage,
    safeMessage: legacyMessage,
    retryable: false,
    errors,
  });

const invalidCursor = () =>
  new DomainError({
    code: errorCodes.INVALID_CURSOR,
    httpStatus: 400,
    message: "Invalid cursor",
    safeMessage: "The pagination cursor is invalid or incompatible",
    retryable: false,
  });

const isPlainScalar = (value) => typeof value === "string";
const normalizedFieldName = (field) => String(field).slice(0, 128);
const fieldError = (field, message) => ({
  field: normalizedFieldName(field),
  message,
});

const normalizeObjectId = (value, field) => {
  const trimmed = value.trim();
  if (!OBJECT_ID_PATTERN.test(trimmed) || !mongoose.Types.ObjectId.isValid(trimmed)) {
    throw validationFailure([fieldError(field, "Must be a valid ObjectId")]);
  }
  return trimmed.toLowerCase();
};

const normalizeStatus = (value, field = "status") => {
  const normalized = value.trim();
  if (!["active", "inactive"].includes(normalized)) {
    throw validationFailure([
      fieldError(field, "Must be one of: active, inactive"),
    ]);
  }
  return normalized;
};

const normalizeBoundedExactFilter = (value, field, maxLength) => {
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > maxLength) {
    throw validationFailure([
      fieldError(field, `Must contain 1 to ${maxLength} characters`),
    ]);
  }
  return normalized;
};

const normalizeTimestamp = (value, field) => {
  const trimmed = value.trim();
  if (!ISO_TIMESTAMP_PATTERN.test(trimmed)) {
    throw validationFailure([
      fieldError(field, "Must be an ISO-8601 timestamp with a timezone"),
    ]);
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw validationFailure([
      fieldError(field, "Must be a valid ISO-8601 timestamp"),
    ]);
  }
  return date.toISOString();
};

const fingerprintQuery = ({ resource, sort, order, filters }) =>
  createHash("sha256")
    .update(canonicalize({ resource, sort, order, filters }))
    .digest("hex");

const decodeCursor = (cursor, expected) => {
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > MAX_CURSOR_LENGTH ||
    !BASE64URL_PATTERN.test(cursor)
  ) {
    throw invalidCursor();
  }

  let decoded;
  let payload;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw invalidCursor();
    decoded = bytes.toString("utf8");
    payload = JSON.parse(decoded);
  } catch (_error) {
    throw invalidCursor();
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidCursor();
  }
  const keys = Object.keys(payload);
  if (
    keys.length !== CURSOR_KEYS.length ||
    !CURSOR_KEYS.every((key) => Object.prototype.hasOwnProperty.call(payload, key))
  ) {
    throw invalidCursor();
  }
  if (
    payload.v !== CURSOR_VERSION ||
    payload.r !== expected.resource ||
    payload.s !== SORT_FIELD ||
    payload.o !== expected.order ||
    payload.q !== expected.fingerprint ||
    !SHA256_PATTERN.test(payload.q) ||
    typeof payload.t !== "string" ||
    !OBJECT_ID_PATTERN.test(payload.i)
  ) {
    throw invalidCursor();
  }
  const timestamp = new Date(payload.t);
  if (
    Number.isNaN(timestamp.getTime()) ||
    timestamp.toISOString() !== payload.t ||
    !mongoose.Types.ObjectId.isValid(payload.i)
  ) {
    throw invalidCursor();
  }

  return {
    createdAt: timestamp,
    id: new mongoose.Types.ObjectId(payload.i),
  };
};

const encodeCursor = ({ resource, order, fingerprint, item }) => {
  const createdAt = new Date(item.createdAt);
  const id = String(item._id).toLowerCase();
  if (Number.isNaN(createdAt.getTime()) || !OBJECT_ID_PATTERN.test(id)) {
    throw new TypeError("Cannot create cursor from invalid resource boundary");
  }

  return Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      r: resource,
      s: SORT_FIELD,
      o: order,
      t: createdAt.toISOString(),
      i: id,
      q: fingerprint,
    }),
    "utf8"
  ).toString("base64url");
};

const normalizeFilters = (resource, query) => {
  const filters = {};
  if (query.status !== undefined) filters.status = normalizeStatus(query.status);

  if (resource === "products" && query.sku !== undefined) {
    filters.sku = normalizeBoundedExactFilter(
      query.sku,
      "sku",
      PRODUCT_SKU_MAX_LENGTH
    );
  }
  if (resource === "warehouses" && query.code !== undefined) {
    filters.code = normalizeBoundedExactFilter(
      query.code,
      "code",
      WAREHOUSE_CODE_MAX_LENGTH
    );
  }

  if (["stocks", "stock-movements"].includes(resource)) {
    for (const field of ["productId", "warehouseId"]) {
      if (query[field] !== undefined) {
        filters[field] = normalizeObjectId(query[field], field);
      }
    }
  }
  if (resource === "stock-movements") {
    if (query.stockId !== undefined) {
      filters.stockId = normalizeObjectId(query.stockId, "stockId");
    }
    if (query.type !== undefined) {
      const type = query.type.trim();
      if (!["GOODS_RECEIPT", "GOODS_ISSUE"].includes(type)) {
        throw validationFailure([
          fieldError("type", "Must be one of: GOODS_RECEIPT, GOODS_ISSUE"),
        ]);
      }
      filters.type = type;
    }
    if (query.reference !== undefined) {
      const reference = query.reference.trim();
      if (!reference || reference.length > 500) {
        throw validationFailure([
          fieldError("reference", "Must contain 1 to 500 characters"),
        ]);
      }
      filters.reference = reference;
    }
    if (query.from !== undefined) filters.from = normalizeTimestamp(query.from, "from");
    if (query.to !== undefined) filters.to = normalizeTimestamp(query.to, "to");
    if (filters.from && filters.to && filters.from > filters.to) {
      throw validationFailure([
        fieldError("from", "Must not be later than to"),
      ]);
    }
  }

  return filters;
};

const parseCollectionQuery = (resource, rawQuery = {}) => {
  const resourceFilters = RESOURCE_FILTERS[resource];
  if (!resourceFilters) throw new TypeError("Unsupported paginated resource");
  const allowed = new Set([...COMMON_PARAMETERS, ...resourceFilters]);
  const query = {};
  const errors = [];

  for (const key of Object.keys(rawQuery || {})) {
    const value = rawQuery[key];
    if (!allowed.has(key)) {
      errors.push(fieldError(key, "Unsupported query parameter"));
      continue;
    }
    if (!isPlainScalar(value)) {
      errors.push(fieldError(key, "Must be provided exactly once as a string"));
      continue;
    }
    query[key] = value;
  }
  if (errors.length > 0) throw validationFailure(errors.slice(0, 50));

  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    if (!/^[1-9]\d*$/.test(query.limit)) {
      throw validationFailure([
        fieldError("limit", `Must be an integer from ${MIN_LIMIT} to ${MAX_LIMIT}`),
      ]);
    }
    limit = Number(query.limit);
    if (limit < MIN_LIMIT || limit > MAX_LIMIT) {
      throw validationFailure([
        fieldError("limit", `Must be an integer from ${MIN_LIMIT} to ${MAX_LIMIT}`),
      ]);
    }
  }

  const sort = query.sort === undefined ? SORT_FIELD : query.sort.trim();
  if (sort !== SORT_FIELD) {
    throw validationFailure([
      fieldError("sort", `Must be ${SORT_FIELD}`),
    ]);
  }
  const order = query.order === undefined ? "desc" : query.order.trim();
  if (!["asc", "desc"].includes(order)) {
    throw validationFailure([
      fieldError("order", "Must be one of: asc, desc"),
    ]);
  }

  const filters = normalizeFilters(resource, query);
  const fingerprint = fingerprintQuery({ resource, sort, order, filters });
  const boundary =
    query.cursor === undefined
      ? null
      : decodeCursor(query.cursor, { resource, order, fingerprint });

  return {
    resource,
    limit,
    sort,
    order,
    direction: order === "asc" ? 1 : -1,
    filters,
    fingerprint,
    boundary,
  };
};

const cursorFilter = ({ boundary, direction }) => {
  if (!boundary) return null;
  const operator = direction === 1 ? "$gt" : "$lt";
  return {
    $or: [
      { createdAt: { [operator]: boundary.createdAt } },
      {
        createdAt: boundary.createdAt,
        _id: { [operator]: boundary.id },
      },
    ],
  };
};

const finishPage = (records, query) => {
  const hasMore = records.length > query.limit;
  const items = records.slice(0, query.limit);
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor({
          resource: query.resource,
          order: query.order,
          fingerprint: query.fingerprint,
          item: items[items.length - 1],
        })
      : null;
  return { items, limit: query.limit, nextCursor };
};

module.exports = {
  COMMON_PARAMETERS,
  CURSOR_KEYS,
  CURSOR_VERSION,
  DEFAULT_LIMIT,
  MAX_CURSOR_LENGTH,
  MAX_LIMIT,
  MIN_LIMIT,
  PRODUCT_SKU_MAX_LENGTH,
  RESOURCE_FILTERS,
  SORT_FIELD,
  WAREHOUSE_CODE_MAX_LENGTH,
  cursorFilter,
  decodeCursor,
  encodeCursor,
  fingerprintQuery,
  finishPage,
  invalidCursor,
  parseCollectionQuery,
  validationFailure,
};
