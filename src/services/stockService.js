const mongoose = require("mongoose");
const withTransaction = require("../utils/transaction");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const {
  buildProductSnapshot,
  buildStockSnapshot,
  buildWarehouseSnapshot,
} = require("./eventSnapshots");

const createDomainError = (code, httpStatus, message, cause) =>
  new DomainError({ code, httpStatus, message, cause });

const normalizeId = (id) => String(id).toLowerCase();

const recordStockCreationEvents = ({
  stocks,
  products,
  updatedProducts,
  warehouses,
  updatedWarehouses,
  eventCollector,
}) => {
  if (!eventCollector) return;

  for (let index = 0; index < stocks.length; index += 1) {
    const stock = stocks[index];
    eventCollector.recordChange({
      eventType: "inventory.stock.created",
      aggregateType: "Stock",
      aggregateId: normalizeId(stock._id),
      aggregateVersion: stock.version,
      before: null,
      after: buildStockSnapshot(stock),
      payload: {
        stockId: normalizeId(stock._id),
        productId: normalizeId(stock.productId),
        warehouseId: normalizeId(stock.warehouseId),
        quantity: stock.quantity,
        aggregateVersion: stock.version,
      },
      metadata: { bulkItemIndex: index },
    });
  }

  for (let index = 0; index < updatedProducts.length; index += 1) {
    const beforeProduct = products[index];
    const afterProduct = updatedProducts[index];
    const linkedStockIds = stocks
      .filter(
        (stock) => normalizeId(stock.productId) === normalizeId(afterProduct._id)
      )
      .map((stock) => normalizeId(stock._id))
      .sort();
    eventCollector.recordChange({
      eventType: "catalog.product.stock-linked",
      aggregateType: "Product",
      aggregateId: normalizeId(afterProduct._id),
      aggregateVersion: afterProduct.version,
      before: buildProductSnapshot(beforeProduct),
      after: buildProductSnapshot(afterProduct),
      payload: {
        productId: normalizeId(afterProduct._id),
        sku: afterProduct.sku,
        linkedStockIds,
        linkedCount: linkedStockIds.length,
        aggregateVersion: afterProduct.version,
      },
      reasonCode: "STOCK_RELATIONSHIP_CREATED",
      metadata: { linkedStockIds, linkedStockCount: linkedStockIds.length },
    });
  }

  for (let index = 0; index < updatedWarehouses.length; index += 1) {
    const beforeWarehouse = warehouses[index];
    const afterWarehouse = updatedWarehouses[index];
    const linkedStockIds = stocks
      .filter(
        (stock) =>
          normalizeId(stock.warehouseId) === normalizeId(afterWarehouse._id)
      )
      .map((stock) => normalizeId(stock._id))
      .sort();
    eventCollector.recordChange({
      eventType: "warehouse.stock-linked",
      aggregateType: "Warehouse",
      aggregateId: normalizeId(afterWarehouse._id),
      aggregateVersion: afterWarehouse.version,
      before: buildWarehouseSnapshot(beforeWarehouse),
      after: buildWarehouseSnapshot(afterWarehouse),
      payload: {
        warehouseId: normalizeId(afterWarehouse._id),
        code: afterWarehouse.code,
        linkedStockIds,
        linkedCount: linkedStockIds.length,
        aggregateVersion: afterWarehouse.version,
      },
      reasonCode: "STOCK_RELATIONSHIP_CREATED",
      metadata: { linkedStockIds, linkedStockCount: linkedStockIds.length },
    });
  }
};

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
  const updatedProducts = [];
  for (const product of products) {
    const updatedProduct = await Product.findOneAndUpdate(
      {
        _id: product._id,
        version: product.version,
        status: "active",
        archivedAt: null,
      },
      { $inc: { version: 1 } },
      { returnDocument: "after", session, runValidators: true }
    );

    if (!updatedProduct) {
      throw createDomainError(
        errorCodes.STALE_VERSION,
        409,
        "Resource version conflict"
      );
    }
    updatedProducts.push(updatedProduct);
  }

  const updatedWarehouses = [];
  for (const warehouse of warehouses) {
    const updatedWarehouse = await Warehouse.findOneAndUpdate(
      {
        _id: warehouse._id,
        version: warehouse.version,
        status: "active",
      },
      { $inc: { version: 1 } },
      { returnDocument: "after", session, runValidators: true }
    );

    if (!updatedWarehouse) {
      throw createDomainError(
        errorCodes.STALE_VERSION,
        409,
        "Resource version conflict"
      );
    }
    updatedWarehouses.push(updatedWarehouse);
  }

  return { updatedProducts, updatedWarehouses };
};

const createStocksInSession = async ({
  stocksToCreate,
  single,
  session,
  eventCollector,
}) => {
  const productIds = [
    ...new Set(stocksToCreate.map(({ productId }) => normalizeId(productId))),
  ];
  const warehouseIds = [
    ...new Set(
      stocksToCreate.map(({ warehouseId }) => normalizeId(warehouseId))
    ),
  ];

  const loadedProducts = await Product.find({
    _id: { $in: productIds },
  }).session(session);
  const loadedWarehouses = await Warehouse.find({
    _id: { $in: warehouseIds },
  }).session(session);

  const productById = new Map(
    loadedProducts.map((product) => [normalizeId(product._id), product])
  );
  const warehouseById = new Map(
    loadedWarehouses.map((warehouse) => [normalizeId(warehouse._id), warehouse])
  );
  const products = productIds.map((id) => productById.get(id)).filter(Boolean);
  const warehouses = warehouseIds
    .map((id) => warehouseById.get(id))
    .filter(Boolean);

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
  const { updatedProducts, updatedWarehouses } = await touchActiveParents({
    products,
    warehouses,
    session,
  });

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

  recordStockCreationEvents({
    stocks,
    products,
    updatedProducts,
    warehouses,
    updatedWarehouses,
    eventCollector,
  });

  return single
    ? stocks[0]
    : {
        createdCount: stocks.length,
        stocks,
      };
};

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

const createStock = async ({
  productId,
  warehouseId,
  session,
  eventCollector,
}) => {
  assertStockIds({ productId, warehouseId });

  try {
    const execute = (currentSession) =>
      createStocksInSession({
        stocksToCreate: [{ productId, warehouseId }],
        single: true,
        session: currentSession,
        eventCollector,
      });
    return await (session ? execute(session) : withTransaction(execute));
  } catch (error) {
    return convertDuplicateError(error, true);
  }
};

const createStocksBulk = async ({
  stocks: stocksToCreate,
  session,
  eventCollector,
}) => {
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
    const execute = (currentSession) =>
      createStocksInSession({
        stocksToCreate,
        single: false,
        session: currentSession,
        eventCollector,
      });
    return await (session ? execute(session) : withTransaction(execute));
  } catch (error) {
    return convertDuplicateError(error, false);
  }
};

module.exports = {
  createStock,
  createStocksBulk,
};
