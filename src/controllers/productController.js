const Product = require("../models/Product");
const mongoose = require("mongoose");

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

const getProducts = async (req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });

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

    const product = await Product.findById(id);

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
    const { sku, name, description, unit, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid product ID",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    if (sku && sku !== product.sku) {
      const existingProduct = await Product.findOne({ sku });

      if (existingProduct) {
        return res.status(409).json({
          message: "A product with this SKU already exists",
        });
      }

      product.sku = sku;
    }

    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (unit !== undefined) product.unit = unit;
    if (status !== undefined) product.status = status;

    const updatedProduct = await product.save();

    return res.status(200).json({
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    error.message = "Could not update product";
    next(error);
  }
};

const deactivateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid product ID",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    product.status = "inactive";

    const updatedProduct = await product.save();

    return res.status(200).json({
      message: "Product deactivated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    error.message = "Could not deactivate product";
    next(error);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid product ID",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    if (product.status === "active") {
      return res.status(409).json({
        message: "Active products must be deactivated before deletion",
      });
    }

    await product.deleteOne();

    return res.status(200).json({
      message: "Product deleted successfully",
    });
  } catch (error) {
    error.message = "Could not delete product";
    next(error);
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deactivateProduct,
  deleteProduct,
};