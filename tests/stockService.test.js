const mongoose = require("mongoose");

const errorCodes = require("../src/errors/errorCodes");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const Warehouse = require("../src/models/Warehouse");
const stockService = require("../src/services/stockService");

require("./setupTestDb");

const createProduct = (sku = "STOCK-SERVICE-001") =>
  Product.create({ sku, name: "Stock Service Product" });

const createWarehouse = (code = "WH-STOCK-SERVICE") =>
  Warehouse.create({ code, name: "Stock Service Warehouse" });

describe("Stock application service", () => {
  it("creates Stock at quantity zero without Express", async () => {
    const [product, warehouse] = await Promise.all([
      createProduct(),
      createWarehouse(),
    ]);

    const stock = await stockService.createStock({
      productId: product._id.toString(),
      warehouseId: warehouse._id.toString(),
    });

    expect(stock.quantity).toBe(0);
    expect(stock.productId).toEqual(product._id);
    expect(stock.warehouseId).toEqual(warehouse._id);
  });

  it("throws a typed not-found error for a missing Product", async () => {
    const warehouse = await createWarehouse();

    await expect(
      stockService.createStock({
        productId: new mongoose.Types.ObjectId().toString(),
        warehouseId: warehouse._id.toString(),
      })
    ).rejects.toMatchObject({
      code: errorCodes.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      message: "Product not found",
    });
  });

  it("throws a typed not-found error for a missing Warehouse", async () => {
    const product = await createProduct();

    await expect(
      stockService.createStock({
        productId: product._id.toString(),
        warehouseId: new mongoose.Types.ObjectId().toString(),
      })
    ).rejects.toMatchObject({
      code: errorCodes.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      message: "Warehouse not found",
    });
  });

  it("throws a typed duplicate error for an existing combination", async () => {
    const [product, warehouse] = await Promise.all([
      createProduct(),
      createWarehouse(),
    ]);
    await Stock.create({ productId: product._id, warehouseId: warehouse._id });

    await expect(
      stockService.createStock({
        productId: product._id.toString(),
        warehouseId: warehouse._id.toString(),
      })
    ).rejects.toMatchObject({
      code: errorCodes.DUPLICATE_RESOURCE,
      httpStatus: 409,
      message: "Stock record already exists for this product and warehouse",
    });
  });

  it("uses VALIDATION_FAILED for a duplicate combination in one bulk command", async () => {
    const [product, warehouse] = await Promise.all([
      createProduct(),
      createWarehouse(),
    ]);
    const stock = {
      productId: product._id.toString(),
      warehouseId: warehouse._id.toString(),
    };

    await expect(
      stockService.createStocksBulk({ stocks: [stock, stock] })
    ).rejects.toMatchObject({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 400,
      message: "Duplicate product and warehouse combinations are not allowed",
    });
  });

  it("preserves INACTIVE_PRODUCT for a genuine inactive Product restriction", async () => {
    const [product, warehouse] = await Promise.all([
      Product.create({
        sku: "STOCK-SERVICE-INACTIVE",
        name: "Inactive Stock Service Product",
        status: "inactive",
      }),
      createWarehouse(),
    ]);

    await expect(
      stockService.createStock({
        productId: product._id.toString(),
        warehouseId: warehouse._id.toString(),
      })
    ).rejects.toMatchObject({
      code: errorCodes.INACTIVE_PRODUCT,
      httpStatus: 409,
      message: "Cannot create stock for inactive product",
    });
  });

  it("bulk creates Stock records with the existing ordered semantics", async () => {
    const products = await Product.create([
      { sku: "STOCK-SERVICE-BULK-001", name: "Bulk Service One" },
      { sku: "STOCK-SERVICE-BULK-002", name: "Bulk Service Two" },
    ]);
    const warehouse = await createWarehouse();

    const result = await stockService.createStocksBulk({
      stocks: products.map((product) => ({
        productId: product._id.toString(),
        warehouseId: warehouse._id.toString(),
      })),
    });

    expect(result.createdCount).toBe(2);
    expect(result.stocks).toHaveLength(2);
    expect(result.stocks.every((stock) => stock.quantity === 0)).toBe(true);
    expect(result.stocks.map((stock) => stock.productId.toString())).toEqual(
      products.map((product) => product._id.toString())
    );
  });
});
