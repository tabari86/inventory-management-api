const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const Warehouse = require("../models/Warehouse");
const {
  cursorFilter,
  finishPage,
  parseCollectionQuery,
} = require("../utils/cursorPagination");

const PRODUCT_PROJECTION =
  "_id sku name description unit status version deactivatedAt deactivatedBy deactivationReason archivedAt archivedBy archiveReason createdAt updatedAt";
const WAREHOUSE_PROJECTION =
  "_id code name description status version deactivatedAt deactivatedBy deactivationReason createdAt updatedAt";
const STOCK_PROJECTION =
  "_id productId warehouseId quantity status version productLifecycleStatus warehouseLifecycleStatus createdAt updatedAt";
const STOCK_MOVEMENT_PROJECTION =
  "_id stockId productId warehouseId type quantity reference reason quantityBefore quantityAfter aggregateVersion productSnapshot warehouseSnapshot createdAt updatedAt";
const PRODUCT_SUMMARY_PROJECTION = "_id sku name unit status archivedAt";
const WAREHOUSE_SUMMARY_PROJECTION = "_id code name status";

const STOCK_POPULATE = Object.freeze([
  { path: "productId", select: PRODUCT_SUMMARY_PROJECTION },
  { path: "warehouseId", select: WAREHOUSE_SUMMARY_PROJECTION },
]);
const STOCK_MOVEMENT_POPULATE = Object.freeze([
  { path: "productId", select: PRODUCT_SUMMARY_PROJECTION },
  { path: "warehouseId", select: WAREHOUSE_SUMMARY_PROJECTION },
  {
    path: "stockId",
    select: STOCK_PROJECTION,
    populate: [
      { path: "productId", select: PRODUCT_SUMMARY_PROJECTION },
      { path: "warehouseId", select: WAREHOUSE_SUMMARY_PROJECTION },
    ],
  },
]);

const buildDatabaseFilter = (resource, parsed) => {
  const filter = {};
  const { filters } = parsed;

  if (resource === "products") filter.archivedAt = null;
  for (const field of [
    "status",
    "sku",
    "code",
    "stockId",
    "productId",
    "warehouseId",
    "type",
    "reference",
  ]) {
    if (filters[field] !== undefined) filter[field] = filters[field];
  }
  if (resource === "stock-movements" && (filters.from || filters.to)) {
    filter.createdAt = {};
    if (filters.from) filter.createdAt.$gte = new Date(filters.from);
    if (filters.to) filter.createdAt.$lte = new Date(filters.to);
  }

  const boundaryFilter = cursorFilter(parsed);
  return boundaryFilter ? { $and: [filter, boundaryFilter] } : filter;
};

const runListQuery = async ({ resource, rawQuery, model, projection, populate = [] }) => {
  const parsed = parseCollectionQuery(resource, rawQuery);
  let databaseQuery = model
    .find(buildDatabaseFilter(resource, parsed))
    .select(projection)
    .sort({ createdAt: parsed.direction, _id: parsed.direction })
    .limit(parsed.limit + 1)
    .lean();

  for (const populateOption of populate) {
    databaseQuery = databaseQuery.populate(populateOption);
  }
  const records = await databaseQuery;
  return finishPage(records, parsed);
};

const listProducts = (rawQuery) =>
  runListQuery({
    resource: "products",
    rawQuery,
    model: Product,
    projection: PRODUCT_PROJECTION,
  });

const listWarehouses = (rawQuery) =>
  runListQuery({
    resource: "warehouses",
    rawQuery,
    model: Warehouse,
    projection: WAREHOUSE_PROJECTION,
  });

const listStocks = (rawQuery) =>
  runListQuery({
    resource: "stocks",
    rawQuery,
    model: Stock,
    projection: STOCK_PROJECTION,
    populate: STOCK_POPULATE,
  });

const listStockMovements = (rawQuery) =>
  runListQuery({
    resource: "stock-movements",
    rawQuery,
    model: StockMovement,
    projection: STOCK_MOVEMENT_PROJECTION,
    populate: STOCK_MOVEMENT_POPULATE,
  });

const validateId = (id, resourceName) => {
  if (!/^[a-fA-F0-9]{24}$/.test(String(id)) || !mongoose.Types.ObjectId.isValid(id)) {
    const message = `Invalid ${resourceName} ID`;
    throw new DomainError({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 400,
      message,
      safeMessage: message,
      retryable: false,
      errors: [],
    });
  }
};

const findById = async ({ id, resourceName, model, filter = {}, projection, populate = [] }) => {
  validateId(id, resourceName);
  let databaseQuery = model
    .findOne({ _id: id, ...filter })
    .select(projection)
    .lean();
  for (const populateOption of populate) {
    databaseQuery = databaseQuery.populate(populateOption);
  }
  return databaseQuery;
};

const getProductById = (id) =>
  findById({
    id,
    resourceName: "product",
    model: Product,
    filter: { archivedAt: null },
    projection: PRODUCT_PROJECTION,
  });

const getWarehouseById = (id) =>
  findById({
    id,
    resourceName: "warehouse",
    model: Warehouse,
    projection: WAREHOUSE_PROJECTION,
  });

const getStockById = (id) =>
  findById({
    id,
    resourceName: "stock",
    model: Stock,
    projection: STOCK_PROJECTION,
    populate: STOCK_POPULATE,
  });

const getStockMovementById = (id) =>
  findById({
    id,
    resourceName: "stock movement",
    model: StockMovement,
    projection: STOCK_MOVEMENT_PROJECTION,
    populate: STOCK_MOVEMENT_POPULATE,
  });

const notFoundError = (message) =>
  new DomainError({
    code: errorCodes.RESOURCE_NOT_FOUND,
    httpStatus: 404,
    message,
    retryable: false,
  });

module.exports = {
  PRODUCT_PROJECTION,
  PRODUCT_SUMMARY_PROJECTION,
  STOCK_MOVEMENT_POPULATE,
  STOCK_MOVEMENT_PROJECTION,
  STOCK_POPULATE,
  STOCK_PROJECTION,
  WAREHOUSE_PROJECTION,
  WAREHOUSE_SUMMARY_PROJECTION,
  getProductById,
  getStockById,
  getStockMovementById,
  getWarehouseById,
  listProducts,
  listStockMovements,
  listStocks,
  listWarehouses,
  notFoundError,
  runListQuery,
  validateId,
};
