const mongoose = require("mongoose");

const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const withTransaction = require("../utils/transaction");

const PRODUCT_FIELDS = ["sku", "name", "description", "unit", "status"];
const normalizeId = (id) => String(id).toLowerCase();

const createDomainError = (code, httpStatus, message, cause) =>
  new DomainError({ code, httpStatus, message, cause });

const assertObjectId = (id, message = "Invalid product ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw createDomainError(errorCodes.VALIDATION_FAILED, 400, message);
  }
};

const assertExpectedVersion = (expectedVersion) => {
  if (
    expectedVersion !== undefined &&
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

const applyProductStockGuard = async ({ productId, guardStatus, session }) => {
  if (!guardStatus) return;

  await Stock.updateMany(
    {
      productId,
      productLifecycleStatus: { $ne: guardStatus },
    },
    {
      $set: { productLifecycleStatus: guardStatus },
      $inc: { version: 1 },
    },
    { session }
  );
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
}) => {
  assertCurrentVersion(product.version);
  assertExpectedVersion(update.expectedVersion);

  if (
    update.expectedVersion !== undefined &&
    update.expectedVersion !== product.version
  ) {
    throw staleVersionError();
  }

  const { fieldsToSet, fieldsToUnset, guardStatus, changed } =
    buildProductUpdate({ product, update, actorId });

  if (!changed) return product;

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
      version: product.version,
      archivedAt: null,
    },
    updateDocument,
    { returnDocument: "after", session, runValidators: true }
  );

  if (!updatedProduct) throw staleVersionError();

  await applyProductStockGuard({
    productId: product._id,
    guardStatus,
    session,
  });

  return updatedProduct;
};

const convertDuplicateError = (error, bulk = false) => {
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

  throw error;
};

const updateProduct = async ({ productId, update, actorId }) => {
  assertObjectId(productId);

  try {
    return await withTransaction(async (session) => {
      const product = await Product.findOne({
        _id: productId,
        archivedAt: null,
      }).session(session);

      if (!product) {
        throw createDomainError(
          errorCodes.RESOURCE_NOT_FOUND,
          404,
          "Product not found"
        );
      }

      return updateProductInSession({ product, update, actorId, session });
    });
  } catch (error) {
    return convertDuplicateError(error);
  }
};

const updateProductsBulk = async ({ updates, actorId }) => {
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
    return await withTransaction(async (session) => {
      const products = await Product.find({
        _id: { $in: ids },
        archivedAt: null,
      }).session(session);

      if (products.length !== ids.length) {
        throw createDomainError(
          errorCodes.RESOURCE_NOT_FOUND,
          404,
          "One or more products were not found"
        );
      }

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

      const productById = new Map(
        products.map((product) => [product._id.toString(), product])
      );

      if (explicitlySubmittedSkus.length > 0) {
        const currentSkuOwners = await Product.find({
          sku: { $in: explicitlySubmittedSkus },
        })
          .session(session)
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
      for (const update of updates) {
        updatedProducts.push(
          await updateProductInSession({
            product: productById.get(normalizeId(update.id)),
            update,
            actorId,
            session,
          })
        );
      }

      return {
        updatedCount: updatedProducts.length,
        products: updatedProducts,
      };
    });
  } catch (error) {
    return convertDuplicateError(error, true);
  }
};

const deactivateProduct = ({
  productId,
  actorId,
  expectedVersion,
  deactivationReason,
}) =>
  updateProduct({
    productId,
    actorId,
    update: { status: "inactive", expectedVersion, deactivationReason },
  });

const archiveProduct = async ({
  productId,
  actorId,
  expectedVersion,
  archiveReason,
}) => {
  assertObjectId(productId);
  assertExpectedVersion(expectedVersion);

  return withTransaction(async (session) => {
    const product = await Product.findById(productId).session(session);

    if (!product || product.archivedAt) {
      throw createDomainError(
        errorCodes.RESOURCE_NOT_FOUND,
        404,
        "Product not found"
      );
    }

    if (product.status === "active") {
      throw createDomainError(
        errorCodes.INACTIVE_PRODUCT,
        409,
        "Active products must be deactivated before deletion"
      );
    }

    assertCurrentVersion(product.version);
    if (expectedVersion !== undefined && expectedVersion !== product.version) {
      throw staleVersionError();
    }

    const fieldsToSet = {
      status: "inactive",
      archivedAt: new Date(),
    };
    if (actorId) fieldsToSet.archivedBy = actorId;
    const reason = normalizeReason(archiveReason);
    if (reason) fieldsToSet.archiveReason = reason;

    const archivedProduct = await Product.findOneAndUpdate(
      { _id: product._id, version: product.version, archivedAt: null },
      { $set: fieldsToSet, $inc: { version: 1 } },
      { returnDocument: "after", session, runValidators: true }
    );

    if (!archivedProduct) throw staleVersionError();

    await applyProductStockGuard({
      productId: product._id,
      guardStatus: "archived",
      session,
    });

    return archivedProduct;
  });
};

const archiveProductsBulk = async ({ ids, actorId, archiveReason }) => {
  ids.forEach((id) => assertObjectId(id));
  const normalizedIds = ids.map(normalizeId);

  if (new Set(normalizedIds).size !== normalizedIds.length) {
    throw createDomainError(
      errorCodes.VALIDATION_FAILED,
      400,
      "Duplicate product IDs are not allowed in the same request"
    );
  }

  return withTransaction(async (session) => {
    const products = await Product.find({
      _id: { $in: normalizedIds },
    }).session(session);

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

    if (products.some((product) => product.status === "active")) {
      throw createDomainError(
        errorCodes.INACTIVE_PRODUCT,
        409,
        "Active products must be deactivated before deletion"
      );
    }

    const productById = new Map(
      products.map((product) => [product._id.toString(), product])
    );
    const reason = normalizeReason(archiveReason);

    for (const id of normalizedIds) {
      const product = productById.get(id);
      assertCurrentVersion(product.version);
      const fieldsToSet = {
        status: "inactive",
        archivedAt: new Date(),
      };
      if (actorId) fieldsToSet.archivedBy = actorId;
      if (reason) fieldsToSet.archiveReason = reason;

      const result = await Product.updateOne(
        { _id: product._id, version: product.version, archivedAt: null },
        { $set: fieldsToSet, $inc: { version: 1 } },
        { session, runValidators: true }
      );

      if (result.modifiedCount !== 1) throw staleVersionError();

      await applyProductStockGuard({
        productId: product._id,
        guardStatus: "archived",
        session,
      });
    }

    return { deletedCount: normalizedIds.length };
  });
};

module.exports = {
  updateProduct,
  updateProductsBulk,
  deactivateProduct,
  archiveProduct,
  archiveProductsBulk,
};
