const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const withTransaction = require("../utils/transaction");
const {
  buildStockSnapshot,
  buildWarehouseSnapshot,
} = require("./eventSnapshots");

const WAREHOUSE_FIELDS = ["name", "description", "status"];
const normalizeId = (id) => String(id).toLowerCase();

const createDomainError = (code, httpStatus, message) =>
  new DomainError({ code, httpStatus, message });

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

const createWarehouse = async ({
  code,
  name,
  description,
  status,
  session,
  eventCollector,
}) => {
  const normalizedCode = code.toUpperCase();
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

  try {
    if (!session) return await Warehouse.create(warehouseData);
    const [warehouse] = await Warehouse.create([warehouseData], { session });
    recordWarehouseTransition({ eventCollector, afterWarehouse: warehouse });
    return warehouse;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error.code === 11000) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        409,
        "A warehouse with this code already exists"
      );
    }
    throw error;
  }
};

const createWarehousesBulk = async ({
  warehouses: input,
  session,
  eventCollector,
}) => {
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

  try {
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
    if (error instanceof DomainError) throw error;
    if (error.code === 11000) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        409,
        "One or more warehouse codes already exist"
      );
    }
    throw error;
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

  return session ? execute(session) : withTransaction(execute);
};

const updateWarehousesBulk = async ({
  updates,
  actorId,
  session,
  eventCollector,
}) => {
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

  return session ? execute(session) : withTransaction(execute);
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
