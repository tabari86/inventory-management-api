const canonicalId = (value) => {
  if (value === null || value === undefined) return value;
  return String(value).toLowerCase();
};

const isoDate = (value) => {
  if (value === null || value === undefined) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
};

const assignDefined = (target, key, value) => {
  if (value !== undefined) target[key] = value;
};

const buildProductSnapshot = (product) => {
  if (product === null) return null;
  const snapshot = {};
  assignDefined(snapshot, "id", canonicalId(product.id ?? product._id));
  assignDefined(snapshot, "sku", product.sku);
  assignDefined(snapshot, "unit", product.unit);
  assignDefined(snapshot, "status", product.status);
  assignDefined(snapshot, "version", product.version);
  assignDefined(snapshot, "deactivatedAt", isoDate(product.deactivatedAt));
  assignDefined(snapshot, "deactivatedBy", canonicalId(product.deactivatedBy));
  assignDefined(snapshot, "deactivationReason", product.deactivationReason);
  assignDefined(snapshot, "archivedAt", isoDate(product.archivedAt));
  assignDefined(snapshot, "archivedBy", canonicalId(product.archivedBy));
  assignDefined(snapshot, "archiveReason", product.archiveReason);
  return snapshot;
};

const buildWarehouseSnapshot = (warehouse) => {
  if (warehouse === null) return null;
  const snapshot = {};
  assignDefined(snapshot, "id", canonicalId(warehouse.id ?? warehouse._id));
  assignDefined(snapshot, "code", warehouse.code);
  assignDefined(snapshot, "status", warehouse.status);
  assignDefined(snapshot, "version", warehouse.version);
  assignDefined(snapshot, "deactivatedAt", isoDate(warehouse.deactivatedAt));
  assignDefined(snapshot, "deactivatedBy", canonicalId(warehouse.deactivatedBy));
  assignDefined(snapshot, "deactivationReason", warehouse.deactivationReason);
  return snapshot;
};

const buildStockSnapshot = (stock) => {
  if (stock === null) return null;
  const snapshot = {};
  assignDefined(snapshot, "id", canonicalId(stock.id ?? stock._id));
  assignDefined(snapshot, "productId", canonicalId(stock.productId));
  assignDefined(snapshot, "warehouseId", canonicalId(stock.warehouseId));
  assignDefined(snapshot, "quantity", stock.quantity);
  assignDefined(snapshot, "status", stock.status);
  assignDefined(snapshot, "version", stock.version);
  assignDefined(
    snapshot,
    "productLifecycleStatus",
    stock.productLifecycleStatus
  );
  assignDefined(
    snapshot,
    "warehouseLifecycleStatus",
    stock.warehouseLifecycleStatus
  );
  return snapshot;
};

const snapshotBuilders = Object.freeze({
  Product: buildProductSnapshot,
  Warehouse: buildWarehouseSnapshot,
  Stock: buildStockSnapshot,
});

const buildSnapshot = (aggregateType, value) => {
  const builder = snapshotBuilders[aggregateType];
  if (!builder) throw new TypeError(`Unsupported aggregate type ${aggregateType}`);
  return builder(value);
};

module.exports = {
  buildProductSnapshot,
  buildSnapshot,
  buildStockSnapshot,
  buildWarehouseSnapshot,
  canonicalId,
  snapshotBuilders,
};
