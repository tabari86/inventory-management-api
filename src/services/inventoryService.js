const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const Warehouse = require("../models/Warehouse");
const withTransaction = require("../utils/transaction");

const createDomainError = (code, httpStatus, message) =>
  new DomainError({ code, httpStatus, message });

const validateSingleInventoryInput = ({ stockId, quantity }) => {
  if (!mongoose.Types.ObjectId.isValid(stockId)) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Invalid stock ID"
    );
  }

  if (!quantity || quantity <= 0) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Quantity must be greater than 0"
    );
  }
};

const getOperationMessages = ({ type, bulk = false }) => {
  const receipt = type === "GOODS_RECEIPT";

  return {
    stockMissing: bulk
      ? "One or more stock records were not found"
      : "Stock record not found",
    stockInactive: receipt
      ? "Cannot receive goods into inactive stock"
      : "Cannot issue goods from inactive stock",
    productMissing: bulk
      ? "One or more products were not found"
      : "Product not found",
    productInactive: receipt
      ? "Cannot receive goods for inactive product"
      : "Cannot issue goods for inactive product",
    warehouseMissing: bulk
      ? "One or more warehouses were not found"
      : "Warehouse not found",
    warehouseInactive: receipt
      ? "Cannot receive goods into inactive warehouse"
      : "Cannot issue goods from inactive warehouse",
  };
};

const validateInventoryContext = ({
  stock,
  product,
  warehouse,
  type,
  bulk = false,
}) => {
  const messages = getOperationMessages({ type, bulk });

  if (!stock) {
    throw createDomainError(
      errorCodes.RESOURCE_NOT_FOUND,
      404,
      messages.stockMissing
    );
  }

  if (stock.status !== "active") {
    throw createDomainError(
      errorCodes.INACTIVE_STOCK,
      409,
      messages.stockInactive
    );
  }

  if (!Number.isInteger(stock.version) || stock.version < 1) {
    throw createDomainError(
      errorCodes.STALE_VERSION,
      409,
      "Resource version conflict"
    );
  }

  if (!product) {
    throw createDomainError(
      errorCodes.RESOURCE_NOT_FOUND,
      404,
      messages.productMissing
    );
  }

  if (product.status !== "active" || product.archivedAt) {
    throw createDomainError(
      errorCodes.INACTIVE_PRODUCT,
      409,
      messages.productInactive
    );
  }

  if (!warehouse) {
    throw createDomainError(
      errorCodes.RESOURCE_NOT_FOUND,
      404,
      messages.warehouseMissing
    );
  }

  if (warehouse.status !== "active") {
    throw createDomainError(
      errorCodes.INACTIVE_WAREHOUSE,
      409,
      messages.warehouseInactive
    );
  }

  if (stock.productLifecycleStatus !== "active") {
    throw createDomainError(
      errorCodes.INACTIVE_PRODUCT,
      409,
      messages.productInactive
    );
  }

  if (stock.warehouseLifecycleStatus !== "active") {
    throw createDomainError(
      errorCodes.INACTIVE_WAREHOUSE,
      409,
      messages.warehouseInactive
    );
  }
};

const createMovementDocument = ({
  item,
  stock,
  product,
  warehouse,
  type,
  quantityBefore,
  quantityAfter,
  aggregateVersion,
}) => ({
  stockId: stock._id,
  productId: product._id,
  warehouseId: warehouse._id,
  type,
  quantity: item.quantity,
  reference: item.reference,
  reason: item.reason,
  quantityBefore,
  quantityAfter,
  aggregateVersion,
  productSnapshot: {
    sku: product.sku,
    name: product.name,
  },
  warehouseSnapshot: {
    code: warehouse.code,
    name: warehouse.name,
  },
});

const loadSingleInventoryContext = async ({ stockId, session }) => {
  const stock = await Stock.findById(stockId).session(session).lean();
  if (!stock) return { stock };

  const product = await Product.findById(stock.productId).session(session);
  const warehouse = await Warehouse.findById(stock.warehouseId).session(
    session
  );

  return { stock, product, warehouse };
};

const updateStockForMovement = async ({ stock, quantity, type, session }) => {
  const decrement = type === "GOODS_ISSUE";
  const filter = {
    _id: stock._id,
    version: stock.version,
    status: "active",
    productLifecycleStatus: "active",
    warehouseLifecycleStatus: "active",
  };

  if (decrement) filter.quantity = { $gte: quantity };

  const updatedStock = await Stock.findOneAndUpdate(
    filter,
    {
      $inc: {
        quantity: decrement ? -quantity : quantity,
        version: 1,
      },
    },
    { returnDocument: "after", session, runValidators: true }
  );

  if (!updatedStock) {
    throw createDomainError(
      decrement ? errorCodes.INSUFFICIENT_STOCK : errorCodes.STALE_VERSION,
      409,
      decrement ? "Not enough stock available" : "Resource version conflict"
    );
  }

  return updatedStock;
};

const createGoodsReceipt = async ({ stockId, quantity, reference, reason }) => {
  validateSingleInventoryInput({ stockId, quantity });

  return withTransaction(async (session) => {
    const { stock, product, warehouse } = await loadSingleInventoryContext({
      stockId,
      session,
    });
    validateInventoryContext({
      stock,
      product,
      warehouse,
      type: "GOODS_RECEIPT",
    });

    const updatedStock = await updateStockForMovement({
      stock,
      quantity,
      type: "GOODS_RECEIPT",
      session,
    });

    const [stockMovement] = await StockMovement.create(
      [
        createMovementDocument({
          item: { quantity, reference, reason },
          stock,
          product,
          warehouse,
          type: "GOODS_RECEIPT",
          quantityBefore: stock.quantity,
          quantityAfter: updatedStock.quantity,
          aggregateVersion: updatedStock.version,
        }),
      ],
      { session }
    );

    return {
      stock: updatedStock,
      stockMovement,
    };
  });
};

const createGoodsIssue = async ({ stockId, quantity, reference, reason }) => {
  validateSingleInventoryInput({ stockId, quantity });

  return withTransaction(async (session) => {
    const { stock, product, warehouse } = await loadSingleInventoryContext({
      stockId,
      session,
    });
    validateInventoryContext({
      stock,
      product,
      warehouse,
      type: "GOODS_ISSUE",
    });

    if (stock.quantity < quantity) {
      throw createDomainError(
        errorCodes.INSUFFICIENT_STOCK,
        409,
        "Not enough stock available"
      );
    }

    const updatedStock = await updateStockForMovement({
      stock,
      quantity,
      type: "GOODS_ISSUE",
      session,
    });

    const [stockMovement] = await StockMovement.create(
      [
        createMovementDocument({
          item: { quantity, reference, reason },
          stock,
          product,
          warehouse,
          type: "GOODS_ISSUE",
          quantityBefore: stock.quantity,
          quantityAfter: updatedStock.quantity,
          aggregateVersion: updatedStock.version,
        }),
      ],
      { session }
    );

    return {
      stock: updatedStock,
      stockMovement,
    };
  });
};

const createBulkInventoryMutation = async ({ items, type }) => {
  const quantityByStockId = new Map();

  for (const item of items) {
    validateSingleInventoryInput(item);
    const stockId = item.stockId.toLowerCase();
    const currentQuantity = quantityByStockId.get(stockId) || 0;
    quantityByStockId.set(stockId, currentQuantity + item.quantity);
  }

  const stockIds = [...quantityByStockId.keys()];

  return withTransaction(async (session) => {
    const stocks = await Stock.find({ _id: { $in: stockIds } })
      .session(session)
      .lean();

    if (stocks.length !== stockIds.length) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "One or more stock records were not found"
      );
    }

    const productIds = [
      ...new Set(stocks.map((stock) => stock.productId.toString())),
    ];
    const warehouseIds = [
      ...new Set(stocks.map((stock) => stock.warehouseId.toString())),
    ];
    const products = await Product.find({ _id: { $in: productIds } }).session(
      session
    );
    const warehouses = await Warehouse.find({
      _id: { $in: warehouseIds },
    }).session(session);

    const productById = new Map(
      products.map((product) => [product._id.toString(), product])
    );
    const warehouseById = new Map(
      warehouses.map((warehouse) => [warehouse._id.toString(), warehouse])
    );
    const stockById = new Map(
      stocks.map((stock) => [stock._id.toString(), stock])
    );

    for (const stock of stocks) {
      validateInventoryContext({
        stock,
        product: productById.get(stock.productId.toString()),
        warehouse: warehouseById.get(stock.warehouseId.toString()),
        type,
        bulk: true,
      });
    }

    if (type === "GOODS_ISSUE") {
      const hasInsufficientStock = [...quantityByStockId].some(
        ([stockId, quantity]) => stockById.get(stockId).quantity < quantity
      );

      if (hasInsufficientStock) {
        throw createDomainError(
          errorCodes.INSUFFICIENT_STOCK,
          409,
          "Not enough stock available"
        );
      }
    }

    const movementDocuments = [];

    for (const item of items) {
      const stockId = item.stockId.toLowerCase();
      const stock = stockById.get(stockId);
      const product = productById.get(stock.productId.toString());
      const warehouse = warehouseById.get(stock.warehouseId.toString());
      const updatedStock = await updateStockForMovement({
        stock,
        quantity: item.quantity,
        type,
        session,
      });

      movementDocuments.push(
        createMovementDocument({
          item,
          stock,
          product,
          warehouse,
          type,
          quantityBefore: stock.quantity,
          quantityAfter: updatedStock.quantity,
          aggregateVersion: updatedStock.version,
        })
      );
      stockById.set(stockId, updatedStock);
    }

    const stockMovements = await StockMovement.insertMany(movementDocuments, {
      session,
    });

    return {
      processedCount: stockMovements.length,
      stockMovements,
      updatedStocks: stockIds.map((stockId) => stockById.get(stockId)),
    };
  });
};

const createGoodsReceiptsBulk = async ({ receipts }) =>
  createBulkInventoryMutation({
    items: receipts,
    type: "GOODS_RECEIPT",
  });

const createGoodsIssuesBulk = async ({ issues }) =>
  createBulkInventoryMutation({
    items: issues,
    type: "GOODS_ISSUE",
  });

module.exports = {
  createGoodsReceipt,
  createGoodsReceiptsBulk,
  createGoodsIssue,
  createGoodsIssuesBulk,
};
