const mongoose = require("mongoose");
const Product = require("../models/Product");
const productService = require("../services/productService");
const { sendInventoryMutation } = require("../services/idempotencyExecutor");
const { buildCanonicalCommand } = require("../utils/canonicalJson");

const normalizeId = (id) => String(id).toLowerCase();
const commandFor = (req, normalizedBody, pathParameters = {}) =>
  buildCanonicalCommand({
    operationId: req.inventoryOperation.operationId,
    pathParameters,
    semanticQueryParameters: {},
    normalizedBody,
  });

const createProduct = async (req, res, next) => {
  try {
    const { sku, name, description, unit, status } = req.body;

    if (!sku || !name) {
      return res.status(400).json({
        message: "SKU and product name are required",
      });
    }

    const input = { sku, name, description, unit, status };

    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, input),
      execute: ({ session, eventCollector }) =>
        productService.createProduct({
          ...input,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (product) => ({
        message: "Product created successfully",
        data: product,
      }),
    });
  } catch (error) {
    error.message = "Could not create product";
    next(error);
  }
};

const createProductsBulk = async (req, res, next) => {
  try {
    const productsToCreate = req.body.map(
      ({ sku, name, description, unit, status }) => ({
        sku,
        name,
        description,
        unit,
        status,
      })
    );
    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, productsToCreate),
      execute: ({ session, eventCollector }) =>
        productService.createProductsBulk({
          products: productsToCreate,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Products created successfully",
        data,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not create products";
    next(error);
  }
};

const updateProductsBulk = async (req, res, next) => {
  try {
    const updates = req.body.map(
      ({
        id,
        sku,
        name,
        description,
        unit,
        status,
        expectedVersion,
        deactivationReason,
      }) => ({
        id,
        sku,
        name,
        description,
        unit,
        status,
        expectedVersion,
        deactivationReason,
      })
    );
    return sendInventoryMutation({
      req,
      res,
      statusCode: 200,
      command: commandFor(
        req,
        updates.map((update) => ({ ...update, id: normalizeId(update.id) }))
      ),
      execute: ({ session, eventCollector }) =>
        productService.updateProductsBulk({
          updates,
          actorId: req.user.id,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Products updated successfully",
        data,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not update products";
    next(error);
  }
};

const deleteProductsBulk = async (req, res, next) => {
  try {
    const ids = req.body.ids;
    return sendInventoryMutation({
      req,
      res,
      statusCode: 200,
      command: commandFor(req, { ids: ids.map(normalizeId) }),
      execute: ({ session, eventCollector }) =>
        productService.archiveProductsBulk({
          ids,
          actorId: req.user.id,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Products deleted successfully",
        data,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not delete products";
    next(error);
  }
};

const getProducts = async (req, res, next) => {
  try {
    const products = await Product.find({ archivedAt: null }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      message: "Products retrieved successfully",
      data: products,
    });
  } catch (error) {
    error.message = "Could not retrieve products";
    next(error);
  }
};

const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid product ID",
      });
    }

    const product = await Product.findOne({ _id: id, archivedAt: null });

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    return res.status(200).json({
      message: "Product retrieved successfully",
      data: product,
    });
  } catch (error) {
    error.message = "Could not retrieve product";
    next(error);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      sku,
      name,
      description,
      unit,
      status,
      expectedVersion,
      deactivationReason,
    } = req.body;
    const update = {
      sku,
      name,
      description,
      unit,
      status,
      expectedVersion,
      deactivationReason,
    };
    return sendInventoryMutation({
      req,
      res,
      statusCode: 200,
      command: commandFor(req, update, { id: normalizeId(id) }),
      execute: ({ session, eventCollector }) =>
        productService.updateProduct({
          productId: id,
          actorId: req.user.id,
          update,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (updatedProduct) => ({
        message: "Product updated successfully",
        data: updatedProduct,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not update product";
    next(error);
  }
};

const deactivateProduct = async (req, res, next) => {
  try {
    const body = req.body || {};
    const input = {
      expectedVersion: body.expectedVersion,
      deactivationReason: body.deactivationReason,
    };
    return sendInventoryMutation({
      req,
      res,
      statusCode: 200,
      command: commandFor(req, input, { id: normalizeId(req.params.id) }),
      execute: ({ session, eventCollector }) =>
        productService.deactivateProduct({
          productId: req.params.id,
          actorId: req.user.id,
          ...input,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (updatedProduct) => ({
        message: "Product deactivated successfully",
        data: updatedProduct,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not deactivate product";
    next(error);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const body = req.body || {};
    const input = {
      expectedVersion: body.expectedVersion,
      archiveReason: body.archiveReason,
    };
    return sendInventoryMutation({
      req,
      res,
      statusCode: 200,
      command: commandFor(req, input, { id: normalizeId(req.params.id) }),
      execute: ({ session, eventCollector }) =>
        productService.archiveProduct({
          productId: req.params.id,
          actorId: req.user.id,
          ...input,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: () => ({
        message: "Product deleted successfully",
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not delete product";
    next(error);
  }
};

module.exports = {
  createProduct,
  createProductsBulk,
  updateProductsBulk,
  deleteProductsBulk,
  getProducts,
  getProductById,
  updateProduct,
  deactivateProduct,
  deleteProduct,
};
