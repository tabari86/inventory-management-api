const definedProperties = (source, fields) => {
  if (source === null || source === undefined) return source;
  const result = {};
  for (const field of fields) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  return result;
};

const PRODUCT_FIELDS = Object.freeze([
  "_id",
  "sku",
  "name",
  "description",
  "unit",
  "status",
  "version",
  "deactivatedAt",
  "deactivatedBy",
  "deactivationReason",
  "archivedAt",
  "archivedBy",
  "archiveReason",
  "createdAt",
  "updatedAt",
]);
const WAREHOUSE_FIELDS = Object.freeze([
  "_id",
  "code",
  "name",
  "description",
  "status",
  "version",
  "deactivatedAt",
  "deactivatedBy",
  "deactivationReason",
  "createdAt",
  "updatedAt",
]);
const STOCK_FIELDS = Object.freeze([
  "_id",
  "productId",
  "warehouseId",
  "quantity",
  "status",
  "version",
  "productLifecycleStatus",
  "warehouseLifecycleStatus",
  "createdAt",
  "updatedAt",
]);
const STOCK_MOVEMENT_FIELDS = Object.freeze([
  "_id",
  "stockId",
  "productId",
  "warehouseId",
  "type",
  "quantity",
  "reference",
  "reason",
  "quantityBefore",
  "quantityAfter",
  "aggregateVersion",
  "productSnapshot",
  "warehouseSnapshot",
  "createdAt",
  "updatedAt",
]);

const presentProductSummary = (product) =>
  definedProperties(product, ["_id", "sku", "name", "unit", "status", "archivedAt"]);

const presentWarehouseSummary = (warehouse) =>
  definedProperties(warehouse, ["_id", "code", "name", "status"]);

const presentReference = (value, presenter, discriminator) => {
  if (
    value &&
    typeof value === "object" &&
    value._id !== undefined &&
    value[discriminator] !== undefined
  ) {
    return presenter(value);
  }
  return value;
};

const presentProduct = (product) => definedProperties(product, PRODUCT_FIELDS);

const presentWarehouse = (warehouse) =>
  definedProperties(warehouse, WAREHOUSE_FIELDS);

const presentStock = (stock) => {
  const presented = definedProperties(stock, STOCK_FIELDS);
  if (presented?.productId !== undefined) {
    presented.productId = presentReference(
      presented.productId,
      presentProductSummary,
      "sku"
    );
  }
  if (presented?.warehouseId !== undefined) {
    presented.warehouseId = presentReference(
      presented.warehouseId,
      presentWarehouseSummary,
      "code"
    );
  }
  return presented;
};

const presentStockMovement = (movement) => {
  const presented = definedProperties(movement, STOCK_MOVEMENT_FIELDS);
  if (presented?.stockId !== undefined) {
    presented.stockId = presentReference(presented.stockId, presentStock, "quantity");
  }
  if (presented?.productId !== undefined) {
    presented.productId = presentReference(
      presented.productId,
      presentProductSummary,
      "sku"
    );
  }
  if (presented?.warehouseId !== undefined) {
    presented.warehouseId = presentReference(
      presented.warehouseId,
      presentWarehouseSummary,
      "code"
    );
  }
  if (presented?.productSnapshot !== undefined) {
    presented.productSnapshot = definedProperties(presented.productSnapshot, [
      "sku",
      "name",
    ]);
  }
  if (presented?.warehouseSnapshot !== undefined) {
    presented.warehouseSnapshot = definedProperties(
      presented.warehouseSnapshot,
      ["code", "name"]
    );
  }
  return presented;
};

const presentProductBulkResult = (result) => {
  const presented = definedProperties(result, [
    "createdCount",
    "updatedCount",
    "deletedCount",
    "products",
  ]);
  if (presented?.products) {
    presented.products = presented.products.map(presentProduct);
  }
  return presented;
};

const presentWarehouseBulkResult = (result) => {
  const presented = definedProperties(result, [
    "createdCount",
    "updatedCount",
    "warehouses",
  ]);
  if (presented?.warehouses) {
    presented.warehouses = presented.warehouses.map(presentWarehouse);
  }
  return presented;
};

const presentStockBulkResult = (result) => {
  const presented = definedProperties(result, ["createdCount", "stocks"]);
  if (presented?.stocks) presented.stocks = presented.stocks.map(presentStock);
  return presented;
};

const presentInventoryMutationResult = (result) => ({
  stock: presentStock(result.stock),
  stockMovement: presentStockMovement(result.stockMovement),
});

const presentBulkInventoryMutationResult = (result) => ({
  processedCount: result.processedCount,
  stockMovements: result.stockMovements.map(presentStockMovement),
  updatedStocks: result.updatedStocks.map(presentStock),
});

module.exports = {
  PRODUCT_FIELDS,
  STOCK_FIELDS,
  STOCK_MOVEMENT_FIELDS,
  WAREHOUSE_FIELDS,
  presentBulkInventoryMutationResult,
  presentInventoryMutationResult,
  presentProduct,
  presentProductBulkResult,
  presentProductSummary,
  presentStock,
  presentStockBulkResult,
  presentStockMovement,
  presentWarehouse,
  presentWarehouseBulkResult,
  presentWarehouseSummary,
};
