const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const normalizeServiceError = require("../src/errors/normalizeServiceError");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const { executeInventoryMutation } = require("../src/services/idempotencyExecutor");
const inventoryService = require("../src/services/inventoryService");
const productService = require("../src/services/productService");
const stockService = require("../src/services/stockService");
const warehouseService = require("../src/services/warehouseService");
const userService = require("../src/services/userService");

require("./setupTestDb");

const validatorError = ({ path, kind, marker = "private rejected value" }) =>
  new mongoose.Error.ValidatorError({
    path,
    type: kind,
    message: marker,
    value: marker,
  });

const createInventory = async (quantity = 5) => {
  const [product, warehouse] = await Promise.all([
    Product.create({ sku: "NORMALIZATION-STOCK", name: "Normalization Stock" }),
    Warehouse.create({
      code: "NORMALIZATION-WH",
      name: "Normalization Warehouse",
    }),
  ]);
  const stock = await Stock.create({
    productId: product._id,
    warehouseId: warehouse._id,
    quantity,
  });
  return { product, warehouse, stock };
};

describe("Verification 1B-A service error contracts", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("V1-ERR-001 types a Product raw failure at the final service boundary", async () => {
    const rawError = new Error("private persistence marker");
    jest.spyOn(Product, "findOne").mockRejectedValueOnce(rawError);

    let thrown;
    try {
      await productService.createProduct({
        sku: "FAIL-FIRST-PRODUCT",
        name: "Fail First Product",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      safeMessage: "Could not create product",
    });
    expect(thrown.cause).toBe(rawError);
  });

  it("V1-ERR-002 classifies direct Warehouse caller validation before unsafe normalization", async () => {
    await expect(
      warehouseService.createWarehouse({
        code: undefined,
        name: "Invalid Warehouse",
      })
    ).rejects.toMatchObject({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 400,
      retryable: false,
    });
  });

  it("V1-ERR-002 validates User passwords before bcrypt", async () => {
    const hashSpy = jest.spyOn(bcrypt, "hash");
    const shortInput = ["s", "h", "o", "r", "t"].join("");

    await expect(
      userService.createUser({
        name: "Invalid User",
        email: "invalid.user@example.com",
        password: shortInput,
      })
    ).rejects.toMatchObject({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 400,
      retryable: false,
    });
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it("V1-ERR-003 uses VALIDATION_FAILED for a duplicate Stock combination in one command", async () => {
    const [product, warehouse] = await Promise.all([
      Product.create({ sku: "FAIL-FIRST-STOCK", name: "Fail First Stock" }),
      Warehouse.create({
        code: "FAIL-FIRST-WH",
        name: "Fail First Warehouse",
      }),
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
      retryable: false,
      safeMessage:
        "Duplicate product and warehouse combinations are not allowed",
    });
  });

  it("V1-ERR-004 uses INVALID_RESOURCE_STATE when archiving an active Product", async () => {
    const product = await Product.create({
      sku: "FAIL-FIRST-ARCHIVE",
      name: "Fail First Archive",
    });

    await expect(
      productService.archiveProduct({ productId: product._id.toString() })
    ).rejects.toMatchObject({
      code: "INVALID_RESOURCE_STATE",
      httpStatus: 409,
      retryable: false,
      safeMessage: "Active products must be deactivated before deletion",
    });
  });

  it("preserves an existing DomainError by identity", () => {
    const domainError = new DomainError({
      code: errorCodes.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      message: "Product not found",
    });

    expect(
      normalizeServiceError(domainError, { safeMessage: "Must not replace" })
    ).toBe(domainError);
  });

  it("normalizes a raw error to a non-retryable INTERNAL_ERROR with its native cause", () => {
    const rawError = new Error("private database detail");
    const normalized = normalizeServiceError(rawError, {
      safeMessage: "Could not complete operation",
    });

    expect(normalized).toBeInstanceOf(DomainError);
    expect(normalized).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      safeMessage: "Could not complete operation",
    });
    expect(normalized.cause).toBe(rawError);
  });

  it("maps only recognized Mongoose validation paths and kinds to bounded safe details", () => {
    const marker = "private-validation-marker";
    const validationFailure = new mongoose.Error.ValidationError();
    validationFailure.addError(
      "name",
      validatorError({ path: "name", kind: "required", marker })
    );

    const normalized = normalizeServiceError(validationFailure, {
      safeMessage: "Could not create resource",
      validationPaths: {
        name: { required: "Name is required" },
      },
    });

    expect(normalized).toMatchObject({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 400,
      retryable: false,
      safeMessage: "Validation failed",
      errors: [{ field: "name", message: "Name is required" }],
    });
    expect(normalized.cause).toBe(validationFailure);
    expect(
      JSON.stringify({
        safeMessage: normalized.safeMessage,
        errors: normalized.errors,
      })
    ).not.toContain(marker);
    expect(Object.keys(normalized.errors[0]).sort()).toEqual([
      "field",
      "message",
    ]);
  });

  it("classifies an unknown Mongoose validation path as INTERNAL_ERROR", () => {
    const validationFailure = new mongoose.Error.ValidationError();
    validationFailure.addError(
      "internalFlag",
      validatorError({ path: "internalFlag", kind: "required" })
    );

    expect(
      normalizeServiceError(validationFailure, {
        safeMessage: "Could not create resource",
        validationPaths: { name: { required: "Name is required" } },
      })
    ).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      errors: [],
    });
  });

  it("classifies an unknown Mongoose validator kind as INTERNAL_ERROR", () => {
    const validationFailure = new mongoose.Error.ValidationError();
    validationFailure.addError(
      "name",
      validatorError({ path: "name", kind: "user defined" })
    );

    expect(
      normalizeServiceError(validationFailure, {
        safeMessage: "Could not create resource",
        validationPaths: { name: { required: "Name is required" } },
      })
    ).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
    });
  });

  it("classifies a residual unexpected CastError as INTERNAL_ERROR", () => {
    const castError = new mongoose.Error.CastError(
      "ObjectId",
      "private-cast-marker",
      "stockId"
    );
    const normalized = normalizeServiceError(castError, {
      safeMessage: "Could not complete inventory operation",
      validationPaths: { stockId: { required: "Stock ID is required" } },
    });

    expect(normalized).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      safeMessage: "Could not complete inventory operation",
    });
    expect(normalized.cause).toBe(castError);
  });

  it("bounds recognized validation detail count, field length, and static message length", () => {
    const validationFailure = new mongoose.Error.ValidationError();
    const longPath = `field-${"x".repeat(150)}`;
    const paths = {};

    for (let index = 0; index < 21; index += 1) {
      const path = index === 0 ? longPath : `field-${index}`;
      paths[path] = { required: "S".repeat(200) };
      validationFailure.addError(
        path,
        validatorError({ path, kind: "required" })
      );
    }

    const normalized = normalizeServiceError(validationFailure, {
      safeMessage: "Could not create resource",
      validationPaths: paths,
    });

    expect(normalized.code).toBe(errorCodes.VALIDATION_FAILED);
    expect(normalized.errors).toHaveLength(20);
    expect(normalized.errors[0].field).toHaveLength(128);
    expect(normalized.errors[0].message).toHaveLength(160);
  });

  it("types a Warehouse raw failure at its final direct boundary", async () => {
    const rawError = new Error("private warehouse persistence marker");
    jest.spyOn(Warehouse, "findOne").mockRejectedValueOnce(rawError);

    await expect(
      warehouseService.createWarehouse({
        code: "RAW-WAREHOUSE",
        name: "Raw Warehouse",
      })
    ).rejects.toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      safeMessage: "Could not create warehouse",
      cause: rawError,
    });
  });

  it("normalizes Stock self-owned transaction failure only after rollback", async () => {
    const [product, warehouse] = await Promise.all([
      Product.create({ sku: "RAW-STOCK", name: "Raw Stock" }),
      Warehouse.create({ code: "RAW-STOCK-WH", name: "Raw Stock Warehouse" }),
    ]);
    const rawError = new Error("private stock driver marker");
    jest.spyOn(Product, "find").mockReturnValueOnce({
      session: jest.fn().mockRejectedValue(rawError),
    });

    await expect(
      stockService.createStock({
        productId: product._id.toString(),
        warehouseId: warehouse._id.toString(),
      })
    ).rejects.toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      cause: rawError,
    });
    expect(await Stock.countDocuments()).toBe(0);
  });

  it("normalizes Inventory self-owned transaction failure after quantity rollback", async () => {
    const { stock } = await createInventory(5);
    const rawError = new Error("private movement persistence marker");
    jest.spyOn(StockMovement, "create").mockRejectedValueOnce(rawError);

    await expect(
      inventoryService.createGoodsReceipt({
        stockId: stock._id.toString(),
        quantity: 3,
      })
    ).rejects.toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      cause: rawError,
    });
    expect((await Stock.findById(stock._id)).quantity).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it("keeps a supplied-session unknown driver error raw for the outer transaction owner", async () => {
    const rawError = new Error("driver labels must remain on this error");
    rawError.errorLabels = ["TransientTransactionError"];
    const query = {
      session: jest.fn().mockReturnThis(),
      then: (resolve, reject) => Promise.reject(rawError).then(resolve, reject),
    };
    jest.spyOn(Product, "findOne").mockReturnValueOnce(query);

    await expect(
      productService.createProduct({
        sku: "SESSION-RAW-PRODUCT",
        name: "Session Raw Product",
        session: { transactionOwner: "outer" },
      })
    ).rejects.toBe(rawError);
    expect(rawError.errorLabels).toEqual(["TransientTransactionError"]);
  });

  it("types the ultimate idempotency executor raw failure after its outer transaction", async () => {
    const rawError = new Error("ultimate transaction marker");
    const requestId = "normalization-request";

    await expect(
      executeInventoryMutation({
        context: {
          actor: { type: "user", id: new mongoose.Types.ObjectId().toString() },
          source: "http-api",
          requestId,
          correlationId: "normalization-correlation",
          causationId: requestId,
        },
        inventoryOperation: {
          operationId: "normalization.operation",
          keyHash: null,
        },
        command: { operationId: "normalization.operation" },
        statusCode: 201,
        execute: jest.fn().mockRejectedValue(rawError),
        buildResponse: jest.fn(),
      })
    ).rejects.toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      safeMessage: "Could not complete request",
      cause: rawError,
    });
  });

  it("rejects direct Product, Stock, and Inventory caller-invalid commands", async () => {
    const invalidCalls = [
      () =>
        productService.createProduct({ sku: "INVALID SKU", name: "Product" }),
      () => stockService.createStocksBulk({ stocks: [] }),
      () =>
        inventoryService.createGoodsReceipt({
          stockId: new mongoose.Types.ObjectId().toString(),
          quantity: 1.5,
        }),
    ];

    for (const invalidCall of invalidCalls) {
      await expect(invalidCall()).rejects.toMatchObject({
        code: errorCodes.VALIDATION_FAILED,
        httpStatus: 400,
        retryable: false,
      });
    }
  });
});
