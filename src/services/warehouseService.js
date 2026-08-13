const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const normalizeServiceError = require("../errors/normalizeServiceError");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const withTransaction = require("../utils/transaction");
const {
  buildStockSnapshot,
  buildWarehouseSnapshot,
} = require("./eventSnapshots");

const WAREHOUSE_FIELDS = ["name", "description", "status"];
const WAREHOUSE_STATUSES = new Set(["active", "inactive"]);
const MAX_BULK_ITEMS = 150;
const WAREHOUSE_VALIDATION_PATHS = Object.freeze({
  code: Object.freeze({
    required: "Warehouse code is required",
    maxlength: "Warehouse code must be at most 64 characters long",
  }),
  name: Object.freeze({ required: "Warehouse name is required" }),
  description: Object.freeze({
    maxlength: "Description must be at most 500 characters long",
  }),
  status: Object.freeze({ enum: "Invalid warehouse status" }),
  deactivationReason: Object.freeze({
    maxlength: "Deactivation reason must be at most 500 characters long",
  }),
});
const normalizeId = (id) => String(id).toLowerCase();

const createDomainError = (code, httpStatus, message, cause) =>
  new DomainError({ code, httpStatus, message, cause });

const validationError = (field, message) =>
  new DomainError({
    code: errorCodes.VALIDATION_FAILED,
    httpStatus: 400,
    message,
    retryable: false,
    errors: [{ field, message }],
  });

const assertCommandObject = (value, field, message) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(field, message);
  }
};

const assertRequiredText = (
  value,
  { field, requiredMessage, max, maxMessage, patternMessage, pattern }
) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(field, requiredMessage);
  }
  const normalized = value.trim();
  if (normalized.length > max) throw validationError(field, maxMessage);
  if (pattern && !pattern.test(normalized.toUpperCase())) {
    throw validationError(field, patternMessage);
  }
};

const assertOptionalText = (value, { field, label, max }) => {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw validationError(field, `${label} must be a string`);
  }
  if (value.trim().length > max) {
    throw validationError(
      field,
      `${label} must be at most ${max} characters long`
    );
  }
};

const assertWarehouseCreateCommand = (warehouse) => {
  assertCommandObject(
    warehouse,
    "request",
    "Warehouse command must be an object"
  );
  assertRequiredText(warehouse.code, {
    field: "code",
    requiredMessage: "Warehouse code is required",
    max: 64,
    maxMessage: "Warehouse code must be at most 64 characters long",
    pattern: /^[A-Z0-9_-]+$/,
    patternMessage:
      "Warehouse code may only contain uppercase letters, numbers, dashes and underscores",
  });
  assertRequiredText(warehouse.name, {
    field: "name",
    requiredMessage: "Warehouse name is required",
    max: 120,
    maxMessage: "Warehouse name must be at most 120 characters long",
  });
  assertOptionalText(warehouse.description, {
    field: "description",
    label: "Description",
    max: 500,
  });
  if (
    warehouse.status !== undefined &&
    !WAREHOUSE_STATUSES.has(warehouse.status)
  ) {
    throw validationError("status", "Invalid warehouse status");
  }
};

const assertWarehouseUpdateCommand = (update) => {
  assertCommandObject(update, "update", "Warehouse update must be an object");
  if (!WAREHOUSE_FIELDS.some((field) => update[field] !== undefined)) {
    throw validationError(
      "update",
      "At least one updatable warehouse field is required"
    );
  }
  if (update.name !== undefined) {
    assertRequiredText(update.name, {
      field: "name",
      requiredMessage: "Warehouse name cannot be empty",
      max: 120,
      maxMessage: "Warehouse name must be at most 120 characters long",
    });
  }
  assertOptionalText(update.description, {
    field: "description",
    label: "Description",
    max: 500,
  });
  assertOptionalText(update.deactivationReason, {
    field: "deactivationReason",
    label: "Deactivation reason",
    max: 500,
  });
  if (update.status !== undefined && !WAREHOUSE_STATUSES.has(update.status)) {
    throw validationError("status", "Invalid warehouse status");
  }
};

const assertBulkArray = (items, field, label) => {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BULK_ITEMS) {
    throw validationError(
      field,
      `${label} must contain between 1 and ${MAX_BULK_ITEMS} items`
    );
  }
};

const throwWarehouseBoundaryError = (
  error,
  { bulk = false, session, safeMessage }
) => {
  if (error instanceof DomainError) throw error;
  if (error?.code === 11000) {
    throw createDomainError(
      errorCodes.DUPLICATE_RESOURCE,
      409,
      bulk
        ? "One or more warehouse codes already exist"
        : "A warehouse with this code already exists",
      error
    );
  }

  const normalized = normalizeServiceError(error, {
    safeMessage,
    validationPaths: WAREHOUSE_VALIDATION_PATHS,
  });
  if (session && normalized.code === errorCodes.INTERNAL_ERROR) throw error;
  throw normalized;
};

const assertObjectId = (id, message = "Invalid warehouse ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw createDomainError(errorCodes.VALIDATION_FAILED, 400, message);
  }
};

const assertExpectedVersion = (expectedVersion) => {
  if (
    expectedVersion !== undefined &&
    (!Number.isInteger(expectedVersion) || expectedVersion < 1)
  ) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Expected version must be a positive integer"
    );
  }
};

const staleVersionError = () =>
  createDomainError(errorCodes.STALE_VERSION, 409, "Resource version conflict");

const assertCurrentVersion = (version) => {
  if (!Number.isInteger(version) || version < 1) throw staleVersionError();
};

const normalizeReason = (reason) => {
  if (typeof reason !== "string") return undefined;
  const normalized = reason.trim();
  return normalized || undefined;
};

const normalizedWarehouseValue = (field, value) => {
  if (
    ["name", "description"].includes(field) &&
    typeof value === "string"
  ) {
    return value.trim();
  }

  return value;
};

const applyWarehouseStockGuard = async ({
  warehouseId,
  guardStatus,
  session,
  eventCollector,
  causeWarehouse,
}) => {
  if (!guardStatus) return [];

  const stocks = await Stock.find({
    warehouseId,
    warehouseLifecycleStatus: { $ne: guardStatus },
  })
    .sort({ _id: 1 })
    .session(session);
  const updatedStocks = [];

  for (const stock of stocks) {
    const updatedStock = await Stock.findOneAndUpdate(
      { _id: stock._id, version: stock.version },
      {
        $set: { warehouseLifecycleStatus: guardStatus },
        $inc: { version: 1 },
      },
      { returnDocument: "after", session, runValidators: true }
    );
    if (!updatedStock) throw staleVersionError();
    updatedStocks.push(updatedStock);
    eventCollector?.recordChange({
      eventType: "inventory.stock.availability-guard-changed",
      aggregateType: "Stock",
      aggregateId: normalizeId(updatedStock._id),
      aggregateVersion: updatedStock.version,
      before: buildStockSnapshot(stock),
      after: buildStockSnapshot(updatedStock),
      payload: {
        stockId: normalizeId(updatedStock._id),
        productId: normalizeId(updatedStock.productId),
        warehouseId: normalizeId(updatedStock.warehouseId),
        beforeGuard: {
          status: stock.status,
          productLifecycleStatus: stock.productLifecycleStatus,
          warehouseLifecycleStatus: stock.warehouseLifecycleStatus,
        },
        afterGuard: {
          status: updatedStock.status,
          productLifecycleStatus: updatedStock.productLifecycleStatus,
          warehouseLifecycleStatus: updatedStock.warehouseLifecycleStatus,
        },
        cause: {
          aggregateType: "Warehouse",
          aggregateId: normalizeId(causeWarehouse._id),
          aggregateVersion: causeWarehouse.version,
        },
        aggregateVersion: updatedStock.version,
      },
      reasonCode: "WAREHOUSE_LIFECYCLE_GUARD_CHANGED",
      metadata: {
        causeAggregateType: "Warehouse",
        causeAggregateId: normalizeId(causeWarehouse._id),
      },
    });
  }

  return updatedStocks;
};

const comparable = (value) => JSON.stringify(value);
const changedSnapshotFields = (before, after) =>
  Object.keys(after)
    .filter((field) => comparable(before[field]) !== comparable(after[field]))
    .sort();

const recordWarehouseTransition = ({
  eventCollector,
  beforeWarehouse,
  afterWarehouse,
  bulkItemIndex,
  forceChanged = false,
  explicitChangedFields,
}) => {
  if (!eventCollector) return;
  const before = beforeWarehouse
    ? buildWarehouseSnapshot(beforeWarehouse)
    : null;
  const after = buildWarehouseSnapshot(afterWarehouse);
  const metadata = {};
  if (bulkItemIndex !== undefined) metadata.bulkItemIndex = bulkItemIndex;

  if (before && !forceChanged && comparable(before) === comparable(after)) {
    eventCollector.recordNoChange({
      aggregateType: "Warehouse",
      aggregateId: normalizeId(afterWarehouse._id),
      aggregateVersion: afterWarehouse.version,
      before,
      after,
      metadata,
    });
    return;
  }

  let eventType = "warehouse.updated";
  let reasonCode = null;
  let payload;
  if (!before) {
    eventType = "warehouse.created";
    payload = {
      warehouseId: normalizeId(afterWarehouse._id),
      code: afterWarehouse.code,
      status: afterWarehouse.status,
      aggregateVersion: afterWarehouse.version,
    };
  } else if (before.status === "inactive" && after.status === "active") {
    eventType = "warehouse.reactivated";
    reasonCode = "WAREHOUSE_REACTIVATED";
    payload = {
      warehouseId: normalizeId(afterWarehouse._id),
      code: afterWarehouse.code,
      previousStatus: before.status,
      status: after.status,
      aggregateVersion: afterWarehouse.version,
    };
  } else if (before.status === "active" && after.status === "inactive") {
    eventType = "warehouse.deactivated";
    reasonCode = "WAREHOUSE_DEACTIVATED";
    payload = {
      warehouseId: normalizeId(afterWarehouse._id),
      code: afterWarehouse.code,
      previousStatus: before.status,
      status: after.status,
      reasonCode,
      aggregateVersion: afterWarehouse.version,
    };
  } else {
    payload = {
      warehouseId: normalizeId(afterWarehouse._id),
      code: afterWarehouse.code,
      changedFields:
        explicitChangedFields || changedSnapshotFields(before, after),
      aggregateVersion: afterWarehouse.version,
    };
  }

  eventCollector.recordChange({
    eventType,
    aggregateType: "Warehouse",
    aggregateId: normalizeId(afterWarehouse._id),
    aggregateVersion: afterWarehouse.version,
    before,
    after,
    payload,
    reasonCode,
    metadata,
  });
};

const buildWarehouseUpdate = ({ warehouse, update, actorId }) => {
  const fieldsToSet = {};
  const fieldsToUnset = {};
  let guardStatus;

  for (const field of WAREHOUSE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(update, field)) continue;

    const value = normalizedWarehouseValue(field, update[field]);
    if (value === undefined) continue;
    if (warehouse[field] === value) continue;

    fieldsToSet[field] = value;
  }

  if (
    Object.prototype.hasOwnProperty.call(fieldsToSet, "status") &&
    fieldsToSet.status === "inactive"
  ) {
    fieldsToSet.deactivatedAt = new Date();
    if (actorId) fieldsToSet.deactivatedBy = actorId;
    const reason = normalizeReason(update.deactivationReason);
    if (reason) fieldsToSet.deactivationReason = reason;
    else fieldsToUnset.deactivationReason = "";
    guardStatus = "inactive";
  }

  if (
    Object.prototype.hasOwnProperty.call(fieldsToSet, "status") &&
    fieldsToSet.status === "active"
  ) {
    fieldsToUnset.deactivatedAt = "";
    fieldsToUnset.deactivatedBy = "";
    fieldsToUnset.deactivationReason = "";
    guardStatus = "active";
  }

  return {
    fieldsToSet,
    fieldsToUnset,
    guardStatus,
    changed: Object.keys(fieldsToSet).length > 0,
  };
};

const updateWarehouseInSession = async ({
  warehouse,
  update,
  actorId,
  session,
  eventCollector,
  bulkItemIndex,
}) => {
  assertCurrentVersion(warehouse.version);
  assertExpectedVersion(update.expectedVersion);

  if (
    update.expectedVersion !== undefined &&
    update.expectedVersion !== warehouse.version
  ) {
    throw staleVersionError();
  }

  const { fieldsToSet, fieldsToUnset, guardStatus, changed } =
    buildWarehouseUpdate({ warehouse, update, actorId });

  if (!changed) {
    recordWarehouseTransition({
      eventCollector,
      beforeWarehouse: warehouse,
      afterWarehouse: warehouse,
      bulkItemIndex,
    });
    return warehouse;
  }

  const updateDocument = {
    $set: fieldsToSet,
    $inc: { version: 1 },
  };

  if (Object.keys(fieldsToUnset).length > 0) {
    updateDocument.$unset = fieldsToUnset;
  }

  const updatedWarehouse = await Warehouse.findOneAndUpdate(
    { _id: warehouse._id, version: warehouse.version },
    updateDocument,
    { returnDocument: "after", session, runValidators: true }
  );

  if (!updatedWarehouse) throw staleVersionError();

  recordWarehouseTransition({
    eventCollector,
    beforeWarehouse: warehouse,
    afterWarehouse: updatedWarehouse,
    bulkItemIndex,
    forceChanged: true,
    explicitChangedFields: [
      ...new Set([
        ...Object.keys(fieldsToSet),
        ...Object.keys(fieldsToUnset),
      ]),
    ]
      .filter((field) => WAREHOUSE_FIELDS.includes(field))
      .sort(),
  });

  await applyWarehouseStockGuard({
    warehouseId: warehouse._id,
    guardStatus,
    session,
    eventCollector,
    causeWarehouse: updatedWarehouse,
  });

  return updatedWarehouse;
};

const createWarehouse = async (command = {}) => {
  assertWarehouseCreateCommand(command);
  const { code, name, description, status, session, eventCollector } = command;
  const normalizedCode = code.toUpperCase();

  try {
    const existingWarehouseQuery = Warehouse.findOne({ code: normalizedCode });
    if (session) existingWarehouseQuery.session(session);
    const existingWarehouse = await existingWarehouseQuery;

    if (existingWarehouse) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        409,
        "A warehouse with this code already exists"
      );
    }

    const warehouseData = {
      code: normalizedCode,
      name,
      description,
      status,
    };

    if (!session) return await Warehouse.create(warehouseData);
    const [warehouse] = await Warehouse.create([warehouseData], { session });
    recordWarehouseTransition({ eventCollector, afterWarehouse: warehouse });
    return warehouse;
  } catch (error) {
    return throwWarehouseBoundaryError(error, {
      session,
      safeMessage: "Could not create warehouse",
    });
  }
};

const createWarehousesBulk = async (command = {}) => {
  const { warehouses: input, session, eventCollector } = command;
  assertBulkArray(input, "warehouses", "Warehouses");
  input.forEach(assertWarehouseCreateCommand);
  const warehousesToCreate = input.map((warehouse) => ({
    ...warehouse,
    code: warehouse.code.toUpperCase(),
  }));
  const codes = warehousesToCreate.map((warehouse) => warehouse.code);

  if (new Set(codes).size !== codes.length) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Duplicate warehouse codes are not allowed in the same request"
    );
  }

  try {
    const existingWarehouseQuery = Warehouse.findOne({ code: { $in: codes } });
    if (session) existingWarehouseQuery.session(session);
    const existingWarehouse = await existingWarehouseQuery;

    if (existingWarehouse) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        409,
        "One or more warehouse codes already exist"
      );
    }

    const warehouses = await Warehouse.insertMany(
      warehousesToCreate,
      session ? { session } : undefined
    );
    for (let index = 0; index < warehouses.length; index += 1) {
      recordWarehouseTransition({
        eventCollector,
        afterWarehouse: warehouses[index],
        bulkItemIndex: index,
      });
    }
    return {
      createdCount: warehouses.length,
      warehouses,
    };
  } catch (error) {
    return throwWarehouseBoundaryError(error, {
      bulk: true,
      session,
      safeMessage: "Could not create warehouses",
    });
  }
};

const updateWarehouse = async ({
  warehouseId,
  update,
  actorId,
  session,
  eventCollector,
}) => {
  assertObjectId(warehouseId);
  assertWarehouseUpdateCommand(update);
  assertExpectedVersion(update.expectedVersion);

  const execute = async (currentSession) => {
    const warehouse = await Warehouse.findById(warehouseId).session(
      currentSession
    );

    if (!warehouse) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "Warehouse not found"
      );
    }

    return updateWarehouseInSession({
      warehouse,
      update,
      actorId,
      session: currentSession,
      eventCollector,
    });
  };

  try {
    return await (session ? execute(session) : withTransaction(execute));
  } catch (error) {
    return throwWarehouseBoundaryError(error, {
      session,
      safeMessage: "Could not update warehouse",
    });
  }
};

const updateWarehousesBulk = async ({
  updates,
  actorId,
  session,
  eventCollector,
}) => {
  assertBulkArray(updates, "updates", "Warehouse updates");
  updates.forEach(assertWarehouseUpdateCommand);
  const ids = updates.map((update) => normalizeId(update.id));
  ids.forEach((id) => assertObjectId(id));

  if (new Set(ids).size !== ids.length) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Duplicate warehouse IDs are not allowed in the same request"
    );
  }

  const execute = async (currentSession) => {
    const warehouses = await Warehouse.find({ _id: { $in: ids } }).session(
      currentSession
    );

    if (warehouses.length !== ids.length) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "One or more warehouses were not found"
      );
    }

    const warehouseById = new Map(
      warehouses.map((warehouse) => [warehouse._id.toString(), warehouse])
    );
    const updatedWarehouses = [];

    for (let index = 0; index < updates.length; index += 1) {
      const update = updates[index];
      updatedWarehouses.push(
        await updateWarehouseInSession({
          warehouse: warehouseById.get(normalizeId(update.id)),
          update,
          actorId,
          session: currentSession,
          eventCollector,
          bulkItemIndex: index,
        })
      );
    }

    return {
      updatedCount: updatedWarehouses.length,
      warehouses: updatedWarehouses,
    };
  };

  try {
    return await (session ? execute(session) : withTransaction(execute));
  } catch (error) {
    return throwWarehouseBoundaryError(error, {
      bulk: true,
      session,
      safeMessage: "Could not update warehouses",
    });
  }
};

const deactivateWarehouse = ({
  warehouseId,
  actorId,
  expectedVersion,
  deactivationReason,
  session,
  eventCollector,
}) =>
  updateWarehouse({
    warehouseId,
    actorId,
    session,
    eventCollector,
    update: { status: "inactive", expectedVersion, deactivationReason },
  });

module.exports = {
  createWarehouse,
  createWarehousesBulk,
  updateWarehouse,
  updateWarehousesBulk,
  deactivateWarehouse,
};
