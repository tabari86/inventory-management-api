const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const normalizeServiceError = require("../errors/normalizeServiceError");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const withTransaction = require("../utils/transaction");
const {
  buildProductSnapshot,
  buildStockSnapshot,
} = require("./eventSnapshots");

const PRODUCT_FIELDS = ["sku", "name", "description", "unit", "status"];
const PRODUCT_UNITS = new Set(["piece", "kg", "liter", "meter"]);
const PRODUCT_STATUSES = new Set(["active", "inactive"]);
const MAX_BULK_ITEMS = 150;
const PRODUCT_VALIDATION_PATHS = Object.freeze({
  sku: Object.freeze({
    required: "SKU is required",
    maxlength: "SKU must be at most 64 characters long",
  }),
  name: Object.freeze({ required: "Product name is required" }),
  description: Object.freeze({
    maxlength: "Description must be at most 500 characters long",
  }),
  unit: Object.freeze({ enum: "Invalid product unit" }),
  status: Object.freeze({ enum: "Invalid product status" }),
  deactivationReason: Object.freeze({
    maxlength: "Deactivation reason must be at most 500 characters long",
  }),
  archiveReason: Object.freeze({
    maxlength: "Archive reason must be at most 500 characters long",
  }),
});
const normalizeId = (id) => String(id).toLowerCase();

const createDomainError = (code, httpStatus, message, cause) =>
  new DomainError({ code, httpStatus, message, cause });

const validationError = (field, message) =>
  new DomainError({
    code: errorCodes.VALIDATION_FAILED,
    httpStatus: 400,
    message,
    retryable: false,
    errors: [{ field, message }],
  });

const assertCommandObject = (value, field, message) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(field, message);
  }
};

const assertRequiredText = (
  value,
  { field, message, max, maxMessage, pattern }
) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(field, message);
  }

  const normalized = value.trim();
  if (normalized.length > max) {
    throw validationError(field, maxMessage);
  }
  if (pattern && !pattern.test(normalized.toUpperCase())) {
    throw validationError(
      field,
      "SKU may only contain uppercase letters, numbers, dashes and underscores"
    );
  }
};

const assertOptionalText = (value, { field, max, label }) => {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw validationError(field, `${label} must be a string`);
  }
  if (value.trim().length > max) {
    throw validationError(
      field,
      `${label} must be at most ${max} characters long`
    );
  }
};

const assertProductCreateCommand = (product) => {
  assertCommandObject(product, "request", "Product command must be an object");
  assertRequiredText(product.sku, {
    field: "sku",
    message: "SKU is required",
    max: 64,
    maxMessage: "SKU must be at most 64 characters long",
    pattern: /^[A-Z0-9_-]+$/,
  });
  assertRequiredText(product.name, {
    field: "name",
    message: "Product name is required",
    max: 120,
    maxMessage: "Product name must be at most 120 characters long",
  });
  assertOptionalText(product.description, {
    field: "description",
    label: "Description",
    max: 500,
  });
  if (product.unit !== undefined && !PRODUCT_UNITS.has(product.unit)) {
    throw validationError("unit", "Invalid product unit");
  }
  if (product.status !== undefined && !PRODUCT_STATUSES.has(product.status)) {
    throw validationError("status", "Invalid product status");
  }
};

const assertProductUpdateCommand = (update) => {
  assertCommandObject(update, "update", "Product update must be an object");
  if (!PRODUCT_FIELDS.some((field) => update[field] !== undefined)) {
    throw validationError(
      "update",
      "At least one updatable product field is required"
    );
  }
  if (update.sku !== undefined) {
    assertRequiredText(update.sku, {
      field: "sku",
      message: "SKU cannot be empty",
      max: 64,
      maxMessage: "SKU must be at most 64 characters long",
      pattern: /^[A-Z0-9_-]+$/,
    });
  }
  if (update.name !== undefined) {
    assertRequiredText(update.name, {
      field: "name",
      message: "Product name cannot be empty",
      max: 120,
      maxMessage: "Product name must be at most 120 characters long",
    });
  }
  assertOptionalText(update.description, {
    field: "description",
    label: "Description",
    max: 500,
  });
  assertOptionalText(update.deactivationReason, {
    field: "deactivationReason",
    label: "Deactivation reason",
    max: 500,
  });
  if (update.unit !== undefined && !PRODUCT_UNITS.has(update.unit)) {
    throw validationError("unit", "Invalid product unit");
  }
  if (update.status !== undefined && !PRODUCT_STATUSES.has(update.status)) {
    throw validationError("status", "Invalid product status");
  }
};

const assertBulkArray = (items, field, label) => {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BULK_ITEMS) {
    throw validationError(
      field,
      `${label} must contain between 1 and ${MAX_BULK_ITEMS} items`
    );
  }
};

const assertObjectId = (id, message = "Invalid product ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw createDomainError(errorCodes.VALIDATION_FAILED, 400, message);
  }
};

const assertExpectedVersion = (expectedVersion) => {
  if (
    (!Number.isInteger(expectedVersion) || expectedVersion < 1)
  ) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Expected version must be a positive integer"
    );
  }
};

const staleVersionError = () =>
  createDomainError(errorCodes.STALE_VERSION, 409, "Resource version conflict");

const assertCurrentVersion = (version) => {
  if (!Number.isInteger(version) || version < 1) throw staleVersionError();
};

const normalizeReason = (reason) => {
  if (typeof reason !== "string") return undefined;
  const normalized = reason.trim();
  return normalized || undefined;
};

const normalizedProductValue = (field, value) => {
  if (field === "sku" && typeof value === "string") {
    return value.trim().toUpperCase();
  }

  if (
    ["name", "description"].includes(field) &&
    typeof value === "string"
  ) {
    return value.trim();
  }

  return value;
};

const stockGuardSnapshot = (stock) => ({
  status: stock.status,
  productLifecycleStatus: stock.productLifecycleStatus,
  warehouseLifecycleStatus: stock.warehouseLifecycleStatus,
});

const applyProductStockGuard = async ({
  productId,
  guardStatus,
  session,
  eventCollector,
  causeProduct,
}) => {
  if (!guardStatus) return [];

  const stocks = await Stock.find({
    productId,
    productLifecycleStatus: { $ne: guardStatus },
  })
    .sort({ _id: 1 })
    .session(session);
  const updatedStocks = [];

  for (const stock of stocks) {
    const updatedStock = await Stock.findOneAndUpdate(
      { _id: stock._id, version: stock.version },
      {
        $set: { productLifecycleStatus: guardStatus },
        $inc: { version: 1 },
      },
      { returnDocument: "after", session, runValidators: true }
    );
    if (!updatedStock) throw staleVersionError();
    updatedStocks.push(updatedStock);

    eventCollector?.recordChange({
      eventType: "inventory.stock.availability-guard-changed",
      aggregateType: "Stock",
      aggregateId: normalizeId(updatedStock._id),
      aggregateVersion: updatedStock.version,
      before: buildStockSnapshot(stock),
      after: buildStockSnapshot(updatedStock),
      payload: {
        stockId: normalizeId(updatedStock._id),
        productId: normalizeId(updatedStock.productId),
        warehouseId: normalizeId(updatedStock.warehouseId),
        beforeGuard: stockGuardSnapshot(stock),
        afterGuard: stockGuardSnapshot(updatedStock),
        cause: {
          aggregateType: "Product",
          aggregateId: normalizeId(causeProduct._id),
          aggregateVersion: causeProduct.version,
        },
        aggregateVersion: updatedStock.version,
      },
      reasonCode: "PRODUCT_LIFECYCLE_GUARD_CHANGED",
      metadata: {
        causeAggregateType: "Product",
        causeAggregateId: normalizeId(causeProduct._id),
      },
    });
  }

  return updatedStocks;
};

const changedSnapshotFields = (before, after) =>
  Object.keys(after)
    .filter(
      (field) =>
        canonicalFieldValue(before[field]) !== canonicalFieldValue(after[field])
    )
    .sort();

const canonicalFieldValue = (value) => JSON.stringify(value);

const recordProductTransition = ({
  eventCollector,
  beforeProduct,
  afterProduct,
  bulkItemIndex,
  forceChanged = false,
  explicitChangedFields,
}) => {
  if (!eventCollector) return;
  const before = beforeProduct ? buildProductSnapshot(beforeProduct) : null;
  const after = buildProductSnapshot(afterProduct);
  const metadata = {};
  if (bulkItemIndex !== undefined) metadata.bulkItemIndex = bulkItemIndex;

  if (
    before &&
    !forceChanged &&
    canonicalFieldValue(before) === canonicalFieldValue(after)
  ) {
    eventCollector.recordNoChange({
      aggregateType: "Product",
      aggregateId: normalizeId(afterProduct._id),
      aggregateVersion: afterProduct.version,
      before,
      after,
      metadata,
    });
    return;
  }

  let eventType = "catalog.product.updated";
  let reasonCode = null;
  let payload;
  if (!before) {
    eventType = "catalog.product.created";
    payload = {
      productId: normalizeId(afterProduct._id),
      sku: afterProduct.sku,
      status: afterProduct.status,
      aggregateVersion: afterProduct.version,
    };
  } else if (!before.archivedAt && after.archivedAt) {
    eventType = "catalog.product.archived";
    reasonCode = "PRODUCT_ARCHIVED";
    payload = {
      productId: normalizeId(afterProduct._id),
      sku: afterProduct.sku,
      status: afterProduct.status,
      archiveReason: afterProduct.archiveReason ?? null,
      aggregateVersion: afterProduct.version,
    };
  } else if (before.status === "inactive" && after.status === "active") {
    eventType = "catalog.product.reactivated";
    reasonCode = "PRODUCT_REACTIVATED";
    payload = {
      productId: normalizeId(afterProduct._id),
      sku: afterProduct.sku,
      previousStatus: before.status,
      status: after.status,
      aggregateVersion: afterProduct.version,
    };
  } else if (before.status === "active" && after.status === "inactive") {
    eventType = "catalog.product.deactivated";
    reasonCode = "PRODUCT_DEACTIVATED";
    payload = {
      productId: normalizeId(afterProduct._id),
      sku: afterProduct.sku,
      previousStatus: before.status,
      status: after.status,
      reasonCode,
      aggregateVersion: afterProduct.version,
    };
  } else {
    payload = {
      productId: normalizeId(afterProduct._id),
      sku: afterProduct.sku,
      changedFields:
        explicitChangedFields || changedSnapshotFields(before, after),
      aggregateVersion: afterProduct.version,
    };
  }

  eventCollector.recordChange({
    eventType,
    aggregateType: "Product",
    aggregateId: normalizeId(afterProduct._id),
    aggregateVersion: afterProduct.version,
    before,
    after,
    payload,
    reasonCode,
    metadata,
  });
};

const buildProductUpdate = ({ product, update, actorId }) => {
  const fieldsToSet = {};
  const fieldsToUnset = {};
  let guardStatus;

  for (const field of PRODUCT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(update, field)) continue;

    const value = normalizedProductValue(field, update[field]);
    if (value === undefined) continue;
    if (product[field] === value) continue;

    fieldsToSet[field] = value;
  }

  if (
    Object.prototype.hasOwnProperty.call(fieldsToSet, "status") &&
    fieldsToSet.status === "inactive"
  ) {
    fieldsToSet.deactivatedAt = new Date();
    if (actorId) fieldsToSet.deactivatedBy = actorId;
    const reason = normalizeReason(update.deactivationReason);
    if (reason) fieldsToSet.deactivationReason = reason;
    else fieldsToUnset.deactivationReason = "";
    guardStatus = "inactive";
  }

  if (
    Object.prototype.hasOwnProperty.call(fieldsToSet, "status") &&
    fieldsToSet.status === "active"
  ) {
    fieldsToUnset.deactivatedAt = "";
    fieldsToUnset.deactivatedBy = "";
    fieldsToUnset.deactivationReason = "";
    guardStatus = "active";
  }

  return {
    fieldsToSet,
    fieldsToUnset,
    guardStatus,
    changed: Object.keys(fieldsToSet).length > 0,
  };
};

const updateProductInSession = async ({
  product,
  update,
  actorId,
  session,
  eventCollector,
  bulkItemIndex,
}) => {
  assertCurrentVersion(product.version);
  assertExpectedVersion(update.expectedVersion);

  if (update.expectedVersion !== product.version) {
    throw staleVersionError();
  }

  const { fieldsToSet, fieldsToUnset, guardStatus, changed } =
    buildProductUpdate({ product, update, actorId });

  if (!changed) {
    recordProductTransition({
      eventCollector,
      beforeProduct: product,
      afterProduct: product,
      bulkItemIndex,
    });
    return product;
  }

  const updateDocument = {
    $set: fieldsToSet,
    $inc: { version: 1 },
  };

  if (Object.keys(fieldsToUnset).length > 0) {
    updateDocument.$unset = fieldsToUnset;
  }

  const updatedProduct = await Product.findOneAndUpdate(
    {
      _id: product._id,
      version: update.expectedVersion,
      archivedAt: null,
    },
    updateDocument,
    { returnDocument: "after", session, runValidators: true }
  );

  if (!updatedProduct) throw staleVersionError();

  recordProductTransition({
    eventCollector,
    beforeProduct: product,
    afterProduct: updatedProduct,
    bulkItemIndex,
    forceChanged: true,
    explicitChangedFields: [
      ...new Set([
        ...Object.keys(fieldsToSet),
        ...Object.keys(fieldsToUnset),
      ]),
    ]
      .filter((field) => PRODUCT_FIELDS.includes(field))
      .sort(),
  });

  await applyProductStockGuard({
    productId: product._id,
    guardStatus,
    session,
    eventCollector,
    causeProduct: updatedProduct,
  });

  return updatedProduct;
};

const throwProductBoundaryError = (
  error,
  { bulk = false, session, safeMessage }
) => {
  if (error instanceof DomainError) throw error;

  if (error.code === 11000) {
    throw createDomainError(
      errorCodes.DUPLICATE_RESOURCE,
      409,
      bulk
        ? "One or more product SKUs already exist"
        : "A product with this SKU already exists",
      error
    );
  }

  const normalized = normalizeServiceError(error, {
    safeMessage,
    validationPaths: PRODUCT_VALIDATION_PATHS,
  });
  if (session && normalized.code === errorCodes.INTERNAL_ERROR) throw error;
  throw normalized;
};

const createProduct = async (command = {}) => {
  assertProductCreateCommand(command);
  const { sku, name, description, unit, status, session, eventCollector } =
    command;

  try {
    const existingProductQuery = Product.findOne({ sku });
    if (session) existingProductQuery.session(session);
    const existingProduct = await existingProductQuery;

    if (existingProduct) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        409,
        "A product with this SKU already exists"
      );
    }

    const productData = { sku, name, description, unit, status };
    if (!session) return Product.create(productData);

    const [product] = await Product.create([productData], { session });
    recordProductTransition({ eventCollector, afterProduct: product });
    return product;
  } catch (error) {
    return throwProductBoundaryError(error, {
      session,
      safeMessage: "Could not create product",
    });
  }
};

const createProductsBulk = async (command = {}) => {
  const { products: productsToCreate, session, eventCollector } = command;
  assertBulkArray(productsToCreate, "products", "Products");
  productsToCreate.forEach(assertProductCreateCommand);
  const skus = productsToCreate.map((product) => product.sku);

  if (new Set(skus).size !== skus.length) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Duplicate SKUs are not allowed in the same request"
    );
  }

  try {
    const existingProductQuery = Product.findOne({ sku: { $in: skus } });
    if (session) existingProductQuery.session(session);
    const existingProduct = await existingProductQuery;

    if (existingProduct) {
      throw createDomainError(
        errorCodes.DUPLICATE_RESOURCE,
        409,
        "One or more product SKUs already exist"
      );
    }

    const products = await Product.insertMany(
      productsToCreate,
      session ? { session } : undefined
    );
    for (let index = 0; index < products.length; index += 1) {
      recordProductTransition({
        eventCollector,
        afterProduct: products[index],
        bulkItemIndex: index,
      });
    }
    return {
      createdCount: products.length,
      products,
    };
  } catch (error) {
    return throwProductBoundaryError(error, {
      bulk: true,
      session,
      safeMessage: "Could not create products",
    });
  }
};

const updateProduct = async ({
  productId,
  update,
  actorId,
  session,
  eventCollector,
}) => {
  assertProductUpdateCommand(update);
  assertExpectedVersion(update.expectedVersion);
  assertObjectId(productId);

  try {
    const execute = async (currentSession) => {
      const product = await Product.findOne({
        _id: productId,
        archivedAt: null,
      }).session(currentSession);

      if (!product) {
        throw createDomainError(
          errorCodes.RESOURCE_NOT_FOUND,
          404,
          "Product not found"
        );
      }

      return updateProductInSession({
        product,
        update,
        actorId,
        session: currentSession,
        eventCollector,
      });
    };

    return await (session ? execute(session) : withTransaction(execute));
  } catch (error) {
    return throwProductBoundaryError(error, {
      session,
      safeMessage: "Could not update product",
    });
  }
};

const updateProductsBulk = async ({
  updates,
  actorId,
  session,
  eventCollector,
}) => {
  assertBulkArray(updates, "updates", "Product updates");
  updates.forEach((update) => {
    assertProductUpdateCommand(update);
    assertExpectedVersion(update.expectedVersion);
  });
  const ids = updates.map((update) => normalizeId(update.id));
  ids.forEach((id) => assertObjectId(id));

  if (new Set(ids).size !== ids.length) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Duplicate product IDs are not allowed in the same request"
    );
  }

  try {
    const execute = async (currentSession) => {
      const products = await Product.find({
        _id: { $in: ids },
        archivedAt: null,
      }).session(currentSession);

      if (products.length !== ids.length) {
        throw createDomainError(
          errorCodes.RESOURCE_NOT_FOUND,
          404,
          "One or more products were not found"
        );
      }

      const productById = new Map(
        products.map((product) => [product._id.toString(), product])
      );
      updates.forEach((update) => {
        const product = productById.get(normalizeId(update.id));
        assertCurrentVersion(product.version);
        if (update.expectedVersion !== product.version) {
          throw staleVersionError();
        }
      });

      const explicitlySubmittedSkus = updates
        .filter((update) => update.sku !== undefined)
        .map((update) => normalizedProductValue("sku", update.sku));

      if (
        new Set(explicitlySubmittedSkus).size !==
        explicitlySubmittedSkus.length
      ) {
        throw createDomainError(
          errorCodes.VALIDATION_FAILED,
          400,
          "Duplicate SKUs are not allowed in the same request"
        );
      }

      if (explicitlySubmittedSkus.length > 0) {
        const currentSkuOwners = await Product.find({
          sku: { $in: explicitlySubmittedSkus },
        })
          .session(currentSession)
          .select("_id sku");
        const ownerIdBySku = new Map(
          currentSkuOwners.map((product) => [
            product.sku,
            product._id.toString(),
          ])
        );
        const hasOwnershipConflict = updates.some((update) => {
          if (update.sku === undefined) return false;

          const requestedSku = normalizedProductValue("sku", update.sku);
          const ownerId = ownerIdBySku.get(requestedSku);
          return ownerId !== undefined && ownerId !== normalizeId(update.id);
        });

        if (hasOwnershipConflict) {
          throw createDomainError(
            errorCodes.DUPLICATE_RESOURCE,
            409,
            "One or more product SKUs already exist"
          );
        }
      }

      const updatedProducts = [];
      for (let index = 0; index < updates.length; index += 1) {
        const update = updates[index];
        updatedProducts.push(
          await updateProductInSession({
            product: productById.get(normalizeId(update.id)),
            update,
            actorId,
            session: currentSession,
            eventCollector,
            bulkItemIndex: index,
          })
        );
      }

      return {
        updatedCount: updatedProducts.length,
        products: updatedProducts,
      };
    };

    return await (session ? execute(session) : withTransaction(execute));
  } catch (error) {
    return throwProductBoundaryError(error, {
      bulk: true,
      session,
      safeMessage: "Could not update products",
    });
  }
};

const deactivateProduct = ({
  productId,
  actorId,
  expectedVersion,
  deactivationReason,
  session,
  eventCollector,
}) =>
  updateProduct({
    productId,
    actorId,
    session,
    eventCollector,
    update: { status: "inactive", expectedVersion, deactivationReason },
  });

const archiveProduct = async ({
  productId,
  actorId,
  expectedVersion,
  archiveReason,
  session,
  eventCollector,
}) => {
  assertExpectedVersion(expectedVersion);
  assertObjectId(productId);
  assertOptionalText(archiveReason, {
    field: "archiveReason",
    label: "Archive reason",
    max: 500,
  });

  const execute = async (currentSession) => {
    const product = await Product.findById(productId).session(currentSession);

    if (!product || product.archivedAt) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "Product not found"
      );
    }

    assertCurrentVersion(product.version);
    if (expectedVersion !== product.version) {
      throw staleVersionError();
    }

    if (product.status === "active") {
      throw createDomainError(
        errorCodes.INVALID_RESOURCE_STATE,
        409,
        "Active products must be deactivated before deletion"
      );
    }

    const fieldsToSet = {
      status: "inactive",
      archivedAt: new Date(),
    };
    if (actorId) fieldsToSet.archivedBy = actorId;
    const reason = normalizeReason(archiveReason);
    if (reason) fieldsToSet.archiveReason = reason;

    const archivedProduct = await Product.findOneAndUpdate(
      { _id: product._id, version: expectedVersion, archivedAt: null },
      { $set: fieldsToSet, $inc: { version: 1 } },
      { returnDocument: "after", session: currentSession, runValidators: true }
    );

    if (!archivedProduct) throw staleVersionError();

    recordProductTransition({
      eventCollector,
      beforeProduct: product,
      afterProduct: archivedProduct,
    });

    await applyProductStockGuard({
      productId: product._id,
      guardStatus: "archived",
      session: currentSession,
      eventCollector,
      causeProduct: archivedProduct,
    });

    return archivedProduct;
  };

  try {
    return await (session ? execute(session) : withTransaction(execute));
  } catch (error) {
    return throwProductBoundaryError(error, {
      session,
      safeMessage: "Could not archive product",
    });
  }
};

const archiveProductsBulk = async ({
  items,
  actorId,
  archiveReason,
  session,
  eventCollector,
}) => {
  assertBulkArray(items, "items", "Product archive items");
  assertOptionalText(archiveReason, {
    field: "archiveReason",
    label: "Archive reason",
    max: 500,
  });
  items.forEach((item) => {
    assertCommandObject(
      item,
      "items",
      "Each Product archive item must be an object"
    );
    assertExpectedVersion(item.expectedVersion);
    assertObjectId(item.id);
  });
  const normalizedIds = items.map(({ id }) => normalizeId(id));

  if (new Set(normalizedIds).size !== normalizedIds.length) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Duplicate product IDs are not allowed in the same request"
    );
  }

  const execute = async (currentSession) => {
    const products = await Product.find({
      _id: { $in: normalizedIds },
    }).session(currentSession);

    if (
      products.length !== normalizedIds.length ||
      products.some((product) => product.archivedAt)
    ) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "One or more products were not found"
      );
    }

    const productById = new Map(
      products.map((product) => [product._id.toString(), product])
    );
    items.forEach(({ id, expectedVersion }) => {
      const product = productById.get(normalizeId(id));
      assertCurrentVersion(product.version);
      if (expectedVersion !== product.version) {
        throw staleVersionError();
      }
    });

    if (products.some((product) => product.status === "active")) {
      throw createDomainError(
        errorCodes.INVALID_RESOURCE_STATE,
        409,
        "Active products must be deactivated before deletion"
      );
    }

    const reason = normalizeReason(archiveReason);

    for (let index = 0; index < items.length; index += 1) {
      const { id: submittedId, expectedVersion } = items[index];
      const id = normalizeId(submittedId);
      const product = productById.get(id);
      const fieldsToSet = {
        status: "inactive",
        archivedAt: new Date(),
      };
      if (actorId) fieldsToSet.archivedBy = actorId;
      if (reason) fieldsToSet.archiveReason = reason;

      const archivedProduct = await Product.findOneAndUpdate(
        { _id: product._id, version: expectedVersion, archivedAt: null },
        { $set: fieldsToSet, $inc: { version: 1 } },
        {
          returnDocument: "after",
          session: currentSession,
          runValidators: true,
        }
      );

      if (!archivedProduct) throw staleVersionError();

      recordProductTransition({
        eventCollector,
        beforeProduct: product,
        afterProduct: archivedProduct,
        bulkItemIndex: index,
      });

      await applyProductStockGuard({
        productId: product._id,
        guardStatus: "archived",
        session: currentSession,
        eventCollector,
        causeProduct: archivedProduct,
      });
    }

    return { deletedCount: normalizedIds.length };
  };

  try {
    return await (session ? execute(session) : withTransaction(execute));
  } catch (error) {
    return throwProductBoundaryError(error, {
      bulk: true,
      session,
      safeMessage: "Could not archive products",
    });
  }
};

module.exports = {
  createProduct,
  createProductsBulk,
  updateProduct,
  updateProductsBulk,
  deactivateProduct,
  archiveProduct,
  archiveProductsBulk,
};
