const API_READ_INDEXES = Object.freeze([
  Object.freeze({
    collection: "products",
    name: "idx_products_non_archived_created_at_id",
    key: Object.freeze({ archivedAt: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "products",
    name: "idx_products_non_archived_status_created_at_id",
    key: Object.freeze({ archivedAt: 1, status: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "warehouses",
    name: "idx_warehouses_created_at_id",
    key: Object.freeze({ createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "warehouses",
    name: "idx_warehouses_status_created_at_id",
    key: Object.freeze({ status: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stocks",
    name: "idx_stocks_created_at_id",
    key: Object.freeze({ createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stocks",
    name: "idx_stocks_product_created_at_id",
    key: Object.freeze({ productId: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stocks",
    name: "idx_stocks_warehouse_created_at_id",
    key: Object.freeze({ warehouseId: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stocks",
    name: "idx_stocks_status_created_at_id",
    key: Object.freeze({ status: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stockmovements",
    name: "idx_stock_movements_created_at_id",
    key: Object.freeze({ createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stockmovements",
    name: "idx_stock_movements_stock_created_at_id",
    key: Object.freeze({ stockId: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stockmovements",
    name: "idx_stock_movements_product_created_at_id",
    key: Object.freeze({ productId: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stockmovements",
    name: "idx_stock_movements_warehouse_created_at_id",
    key: Object.freeze({ warehouseId: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stockmovements",
    name: "idx_stock_movements_type_created_at_id",
    key: Object.freeze({ type: 1, createdAt: 1, _id: 1 }),
  }),
  Object.freeze({
    collection: "stockmovements",
    name: "idx_stock_movements_reference_created_at_id",
    key: Object.freeze({ reference: 1, createdAt: 1, _id: 1 }),
  }),
]);

const indexesForCollection = (collection) =>
  API_READ_INDEXES.filter((definition) => definition.collection === collection);

module.exports = {
  API_READ_INDEXES,
  indexesForCollection,
};
