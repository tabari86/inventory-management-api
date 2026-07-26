const operations = Object.freeze({
  PRODUCT_BULK_CREATE: "catalog.product.bulk-create.v1",
  PRODUCT_BULK_UPDATE: "catalog.product.bulk-update.v1",
  PRODUCT_BULK_ARCHIVE: "catalog.product.bulk-archive.v1",
  PRODUCT_CREATE: "catalog.product.create.v1",
  PRODUCT_UPDATE: "catalog.product.update.v1",
  PRODUCT_DEACTIVATE: "catalog.product.deactivate.v1",
  PRODUCT_ARCHIVE: "catalog.product.archive.v1",
  WAREHOUSE_BULK_CREATE: "warehouse.bulk-create.v1",
  WAREHOUSE_BULK_UPDATE: "warehouse.bulk-update.v1",
  WAREHOUSE_CREATE: "warehouse.create.v1",
  WAREHOUSE_UPDATE: "warehouse.update.v1",
  WAREHOUSE_DEACTIVATE: "warehouse.deactivate.v1",
  STOCK_BULK_CREATE: "inventory.stock.bulk-create.v1",
  STOCK_CREATE: "inventory.stock.create.v1",
  GOODS_RECEIPT_BULK: "inventory.goods-receipt.bulk.v1",
  GOODS_RECEIPT_SINGLE: "inventory.goods-receipt.single.v1",
  GOODS_ISSUE_BULK: "inventory.goods-issue.bulk.v1",
  GOODS_ISSUE_SINGLE: "inventory.goods-issue.single.v1",
});

const mutationOperationRegistry = Object.freeze([
  {
    method: "post",
    path: "/api/products/bulk",
    operationId: operations.PRODUCT_BULK_CREATE,
  },
  {
    method: "patch",
    path: "/api/products/bulk",
    operationId: operations.PRODUCT_BULK_UPDATE,
  },
  {
    method: "delete",
    path: "/api/products/bulk",
    operationId: operations.PRODUCT_BULK_ARCHIVE,
  },
  {
    method: "post",
    path: "/api/products",
    operationId: operations.PRODUCT_CREATE,
  },
  {
    method: "patch",
    path: "/api/products/{id}",
    operationId: operations.PRODUCT_UPDATE,
  },
  {
    method: "patch",
    path: "/api/products/{id}/deactivate",
    operationId: operations.PRODUCT_DEACTIVATE,
  },
  {
    method: "delete",
    path: "/api/products/{id}",
    operationId: operations.PRODUCT_ARCHIVE,
  },
  {
    method: "post",
    path: "/api/warehouses/bulk",
    operationId: operations.WAREHOUSE_BULK_CREATE,
  },
  {
    method: "patch",
    path: "/api/warehouses/bulk",
    operationId: operations.WAREHOUSE_BULK_UPDATE,
  },
  {
    method: "post",
    path: "/api/warehouses",
    operationId: operations.WAREHOUSE_CREATE,
  },
  {
    method: "patch",
    path: "/api/warehouses/{id}",
    operationId: operations.WAREHOUSE_UPDATE,
  },
  {
    method: "patch",
    path: "/api/warehouses/{id}/deactivate",
    operationId: operations.WAREHOUSE_DEACTIVATE,
  },
  {
    method: "post",
    path: "/api/stocks/bulk",
    operationId: operations.STOCK_BULK_CREATE,
  },
  {
    method: "post",
    path: "/api/stocks",
    operationId: operations.STOCK_CREATE,
  },
  {
    method: "post",
    path: "/api/goods-receipts/bulk",
    operationId: operations.GOODS_RECEIPT_BULK,
  },
  {
    method: "post",
    path: "/api/goods-receipts",
    operationId: operations.GOODS_RECEIPT_SINGLE,
  },
  {
    method: "post",
    path: "/api/goods-issues/bulk",
    operationId: operations.GOODS_ISSUE_BULK,
  },
  {
    method: "post",
    path: "/api/goods-issues",
    operationId: operations.GOODS_ISSUE_SINGLE,
  },
]);

module.exports = {
  mutationOperationRegistry,
  operations,
};
