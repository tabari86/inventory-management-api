const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");

const createDomainError = (code, httpStatus, message, cause) =>
  new DomainError({ code, httpStatus, message, cause });

const createStock = async ({ productId, warehouseId }) => {
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

  const product = await Product.findById(productId);

  if (!product) {
    throw createDomainError(
      errorCodes.RESOURCE_NOT_FOUND,
      404,
      "Product not found"
    );
  }

  if (product.status !== "active") {
    throw createDomainError(
      errorCodes.INACTIVE_PRODUCT,
      409,
      "Cannot create stock for inactive product"
    );
  }

  const warehouse = await Warehouse.findById(warehouseId);

  if (!warehouse) {
    throw createDomainError(
      errorCodes.RESOURCE_NOT_FOUND,
      404,
      "Warehouse not found"
    );
  }

  if (warehouse.status !== "active") {
    throw createDomainError(
      errorCodes.INACTIVE_WAREHOUSE,
      409,
      "Cannot create stock for inactive warehouse"
    );
  }

  const existingStock = await Stock.findOne({ productId, warehouseId });

  if (existingStock) {
    throw createDomainError(
      errorCodes.DUPLICATE_RESOURCE,
      409,
      "Stock record already exists for this product and warehouse"
    );
  }

  return Stock.create({
    productId,
    warehouseId,
    quantity: 0,
  });
};

const createStocksBulk = async ({ stocks: stocksToCreate }) => {
  try {
    const combinations = stocksToCreate.map(
      (stock) =>
        `${stock.productId.toLowerCase()}:${stock.warehouseId.toLowerCase()}`
    );

    if (new Set(combinations).size !== combinations.length) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        400,
        "Duplicate product and warehouse combinations are not allowed"
      );
    }

    const productIds = [
      ...new Set(stocksToCreate.map((stock) => stock.productId.toLowerCase())),
    ];
    const warehouseIds = [
      ...new Set(
        stocksToCreate.map((stock) => stock.warehouseId.toLowerCase())
      ),
    ];
    const [products, warehouses] = await Promise.all([
      Product.find({ _id: { $in: productIds } }),
      Warehouse.find({ _id: { $in: warehouseIds } }),
    ]);

    if (products.length !== productIds.length) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "One or more products were not found"
      );
    }

    if (products.some((product) => product.status !== "active")) {
      throw createDomainError(
        errorCodes.INACTIVE_PRODUCT,
        409,
        "Cannot create stock for inactive products"
      );
    }

    if (warehouses.length !== warehouseIds.length) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "One or more warehouses were not found"
      );
    }

    if (warehouses.some((warehouse) => warehouse.status !== "active")) {
      throw createDomainError(
        errorCodes.INACTIVE_WAREHOUSE,
        409,
        "Cannot create stock for inactive warehouses"
      );
    }

    const existingStock = await Stock.findOne({
      $or: stocksToCreate.map(({ productId, warehouseId }) => ({
        productId,
        warehouseId,
      })),
    });

    if (existingStock) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        409,
        "One or more stock records already exist"
      );
    }

    const stocks = await Stock.insertMany(
      stocksToCreate.map((stock) => ({ ...stock, quantity: 0 }))
    );

    return {
      createdCount: stocks.length,
      stocks,
    };
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    if (error.code === 11000) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        409,
        "One or more stock records already exist",
        error
      );
    }

    throw error;
  }
};

module.exports = {
  createStock,
  createStocksBulk,
};
