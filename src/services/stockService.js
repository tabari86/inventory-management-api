const mongoose = require("mongoose");
const withTransaction = require("../utils/transaction");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");

const createDomainError = (code, httpStatus, message, cause) =>
  new DomainError({ code, httpStatus, message, cause });

const normalizeId = (id) => String(id).toLowerCase();

const assertStockIds = ({ productId, warehouseId }) => {
  if (
    !mongoose.Types.ObjectId.isValid(productId) ||
    !mongoose.Types.ObjectId.isValid(warehouseId)
  ) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Invalid product or warehouse ID"
    );
  }
};

const validateParents = ({ products, warehouses, productIds, warehouseIds }) => {
  if (products.length !== productIds.length) {
    throw createDomainError(
      errorCodes.RESOURCE_NOT_FOUND,
      404,
      productIds.length === 1
        ? "Product not found"
        : "One or more products were not found"
    );
  }

  if (
    products.some(
      (product) => product.status !== "active" || product.archivedAt
    )
  ) {
    throw createDomainError(
      errorCodes.INACTIVE_PRODUCT,
      409,
      productIds.length === 1
        ? "Cannot create stock for inactive product"
        : "Cannot create stock for inactive products"
    );
  }

  if (
    products.some(
      (product) => !Number.isInteger(product.version) || product.version < 1
    )
  ) {
    throw createDomainError(
      errorCodes.STALE_VERSION,
      409,
      "Resource version conflict"
    );
  }

  if (warehouses.length !== warehouseIds.length) {
    throw createDomainError(
      errorCodes.RESOURCE_NOT_FOUND,
      404,
      warehouseIds.length === 1
        ? "Warehouse not found"
        : "One or more warehouses were not found"
    );
  }

  if (warehouses.some((warehouse) => warehouse.status !== "active")) {
    throw createDomainError(
      errorCodes.INACTIVE_WAREHOUSE,
      409,
      warehouseIds.length === 1
        ? "Cannot create stock for inactive warehouse"
        : "Cannot create stock for inactive warehouses"
    );
  }

  if (
    warehouses.some(
      (warehouse) =>
        !Number.isInteger(warehouse.version) || warehouse.version < 1
    )
  ) {
    throw createDomainError(
      errorCodes.STALE_VERSION,
      409,
      "Resource version conflict"
    );
  }
};

const touchActiveParents = async ({ products, warehouses, session }) => {
  for (const product of products) {
    const result = await Product.updateOne(
      {
        _id: product._id,
        version: product.version,
        status: "active",
        archivedAt: null,
      },
      { $inc: { version: 1 } },
      { session }
    );

    if (result.modifiedCount !== 1) {
      throw createDomainError(
        errorCodes.STALE_VERSION,
        409,
        "Resource version conflict"
      );
    }
  }

  for (const warehouse of warehouses) {
    const result = await Warehouse.updateOne(
      {
        _id: warehouse._id,
        version: warehouse.version,
        status: "active",
      },
      { $inc: { version: 1 } },
      { session }
    );

    if (result.modifiedCount !== 1) {
      throw createDomainError(
        errorCodes.STALE_VERSION,
        409,
        "Resource version conflict"
      );
    }
  }
};

const createStocksInTransaction = async ({ stocksToCreate, single }) =>
  withTransaction(async (session) => {
    const productIds = [
      ...new Set(stocksToCreate.map(({ productId }) => normalizeId(productId))),
    ];
    const warehouseIds = [
      ...new Set(
        stocksToCreate.map(({ warehouseId }) => normalizeId(warehouseId))
      ),
    ];

    const products = await Product.find({ _id: { $in: productIds } }).session(
      session
    );
    const warehouses = await Warehouse.find({
      _id: { $in: warehouseIds },
    }).session(session);

    validateParents({ products, warehouses, productIds, warehouseIds });

    const existingStock = await Stock.findOne({
      $or: stocksToCreate.map(({ productId, warehouseId }) => ({
        productId,
        warehouseId,
      })),
    }).session(session);

    if (existingStock) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        409,
        single
          ? "Stock record already exists for this product and warehouse"
          : "One or more stock records already exist"
      );
    }

    // This conditional write makes parent lifecycle changes conflict with the
    // relationship creation. One version increment represents this command's
    // relationship change for each distinct parent aggregate.
    await touchActiveParents({ products, warehouses, session });

    const stocks = await Stock.create(
      stocksToCreate.map(({ productId, warehouseId }) => ({
        productId,
        warehouseId,
        quantity: 0,
        version: 1,
        productLifecycleStatus: "active",
        warehouseLifecycleStatus: "active",
      })),
      { session, ordered: true }
    );

    return single
      ? stocks[0]
      : {
          createdCount: stocks.length,
          stocks,
        };
  });

const convertDuplicateError = (error, single) => {
  if (error instanceof DomainError) throw error;

  if (error.code === 11000) {
    throw createDomainError(
      errorCodes.DUPLICATE_RESOURCE,
      409,
      single
        ? "Stock record already exists for this product and warehouse"
        : "One or more stock records already exist",
      error
    );
  }

  throw error;
};

const createStock = async ({ productId, warehouseId }) => {
  assertStockIds({ productId, warehouseId });

  try {
    return await createStocksInTransaction({
      stocksToCreate: [{ productId, warehouseId }],
      single: true,
    });
  } catch (error) {
    return convertDuplicateError(error, true);
  }
};

const createStocksBulk = async ({ stocks: stocksToCreate }) => {
  for (const stock of stocksToCreate) assertStockIds(stock);

  const combinations = stocksToCreate.map(
    ({ productId, warehouseId }) =>
      `${normalizeId(productId)}:${normalizeId(warehouseId)}`
  );

  if (new Set(combinations).size !== combinations.length) {
    throw createDomainError(
      errorCodes.DUPLICATE_RESOURCE,
      400,
      "Duplicate product and warehouse combinations are not allowed"
    );
  }

  try {
    return await createStocksInTransaction({ stocksToCreate, single: false });
  } catch (error) {
    return convertDuplicateError(error, false);
  }
};

module.exports = {
  createStock,
  createStocksBulk,
};
