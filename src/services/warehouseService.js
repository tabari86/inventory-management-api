const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const withTransaction = require("../utils/transaction");

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
}) => {
  if (!guardStatus) return;

  await Stock.updateMany(
    {
      warehouseId,
      warehouseLifecycleStatus: { $ne: guardStatus },
    },
    {
      $set: { warehouseLifecycleStatus: guardStatus },
      $inc: { version: 1 },
    },
    { session }
  );
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

  if (!changed) return warehouse;

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

  await applyWarehouseStockGuard({
    warehouseId: warehouse._id,
    guardStatus,
    session,
  });

  return updatedWarehouse;
};

const createWarehouse = async ({
  code,
  name,
  description,
  status,
  session,
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

const createWarehousesBulk = async ({ warehouses: input, session }) => {
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

const updateWarehouse = async ({ warehouseId, update, actorId, session }) => {
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
    });
  };

  return session ? execute(session) : withTransaction(execute);
};

const updateWarehousesBulk = async ({ updates, actorId, session }) => {
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

    for (const update of updates) {
      updatedWarehouses.push(
        await updateWarehouseInSession({
          warehouse: warehouseById.get(normalizeId(update.id)),
          update,
          actorId,
          session: currentSession,
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
}) =>
  updateWarehouse({
    warehouseId,
    actorId,
    session,
    update: { status: "inactive", expectedVersion, deactivationReason },
  });

module.exports = {
  createWarehouse,
  createWarehousesBulk,
  updateWarehouse,
  updateWarehousesBulk,
  deactivateWarehouse,
};
