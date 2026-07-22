const Product = require("../models/Product");
const mongoose = require("mongoose");
const productService = require("../services/productService");

const createProduct = async (req, res, next) => {
  try {
    const { sku, name, description, unit, status } = req.body;

    if (!sku || !name) {
      return res.status(400).json({
        message: "SKU and product name are required",
      });
    }

    const existingProduct = await Product.findOne({ sku });

    if (existingProduct) {
      return res.status(409).json({
        message: "A product with this SKU already exists",
      });
    }

    const product = await Product.create({
      sku,
      name,
      description,
      unit,
      status,
    });

    return res.status(201).json({
      message: "Product created successfully",
      data: product,
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
    const skus = productsToCreate.map((product) => product.sku);

    if (new Set(skus).size !== skus.length) {
      return res.status(400).json({
        message: "Duplicate SKUs are not allowed in the same request",
      });
    }

    const existingProduct = await Product.findOne({ sku: { $in: skus } });

    if (existingProduct) {
      return res.status(409).json({
        message: "One or more product SKUs already exist",
      });
    }

    const products = await Product.insertMany(productsToCreate);

    return res.status(201).json({
      message: "Products created successfully",
      data: {
        createdCount: products.length,
        products,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "One or more product SKUs already exist",
      });
    }

    error.message = "Could not create products";
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
    const data = await productService.updateProductsBulk({
      updates,
      actorId: req.user.id,
    });

    return res.status(200).json({
      message: "Products updated successfully",
      data,
    });
  } catch (error) {
    error.clientMessage = "Could not update products";
    next(error);
  }
};

const deleteProductsBulk = async (req, res, next) => {
  try {
    const data = await productService.archiveProductsBulk({
      ids: req.body.ids,
      actorId: req.user.id,
    });

    return res.status(200).json({
      message: "Products deleted successfully",
      data,
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
    const updatedProduct = await productService.updateProduct({
      productId: id,
      actorId: req.user.id,
      update: {
        sku,
        name,
        description,
        unit,
        status,
        expectedVersion,
        deactivationReason,
      },
    });

    return res.status(200).json({
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    error.clientMessage = "Could not update product";
    next(error);
  }
};

const deactivateProduct = async (req, res, next) => {
  try {
    const body = req.body || {};
    const updatedProduct = await productService.deactivateProduct({
      productId: req.params.id,
      actorId: req.user.id,
      expectedVersion: body.expectedVersion,
      deactivationReason: body.deactivationReason,
    });

    return res.status(200).json({
      message: "Product deactivated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    error.clientMessage = "Could not deactivate product";
    next(error);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const body = req.body || {};
    await productService.archiveProduct({
      productId: req.params.id,
      actorId: req.user.id,
      expectedVersion: body.expectedVersion,
      archiveReason: body.archiveReason,
    });

    return res.status(200).json({
      message: "Product deleted successfully",
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
