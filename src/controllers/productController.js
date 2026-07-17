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

const createProductsBulk = async (req, res, next) => {
  try {
    const productsToCreate = req.body;
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
    const updates = req.body;
    const ids = updates.map((product) => product.id);

    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({
        message: "Duplicate product IDs are not allowed in the same request",
      });
    }

    const products = await Product.find({ _id: { $in: ids } });

    if (products.length !== ids.length) {
      return res.status(404).json({
        message: "One or more products were not found",
      });
    }

    const skuUpdates = updates.filter((product) => product.sku !== undefined);
    const updatedSkus = skuUpdates.map((product) => product.sku);

    if (new Set(updatedSkus).size !== updatedSkus.length) {
      return res.status(400).json({
        message: "Duplicate SKUs are not allowed in the same request",
      });
    }

    if (updatedSkus.length > 0) {
      const productsWithUpdatedSkus = await Product.find({
        sku: { $in: updatedSkus },
      }).select("_id sku");
      const skuOwnerBySku = new Map(
        skuUpdates.map((product) => [product.sku, product.id])
      );
      const hasConflict = productsWithUpdatedSkus.some(
        (product) => skuOwnerBySku.get(product.sku) !== product._id.toString()
      );

      if (hasConflict) {
        return res.status(409).json({
          message: "One or more product SKUs already exist",
        });
      }
    }

    const updatableFields = ["sku", "name", "description", "unit", "status"];
    const operations = updates.map(({ id, ...update }) => {
      const fieldsToUpdate = {};

      for (const field of updatableFields) {
        if (Object.prototype.hasOwnProperty.call(update, field)) {
          fieldsToUpdate[field] = update[field];
        }
      }

      return {
        updateOne: {
          filter: { _id: id },
          update: { $set: fieldsToUpdate },
        },
      };
    });

    await Product.bulkWrite(operations);

    const updatedProducts = await Product.find({ _id: { $in: ids } });
    const productById = new Map(
      updatedProducts.map((product) => [product._id.toString(), product])
    );

    return res.status(200).json({
      message: "Products updated successfully",
      data: {
        updatedCount: updatedProducts.length,
        products: ids.map((id) => productById.get(id)),
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "One or more product SKUs already exist",
      });
    }

    error.message = "Could not update products";
    next(error);
  }
};

const deleteProductsBulk = async (req, res, next) => {
  try {
    const { ids } = req.body;

    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({
        message: "Duplicate product IDs are not allowed in the same request",
      });
    }

    const products = await Product.find({ _id: { $in: ids } });

    if (products.length !== ids.length) {
      return res.status(404).json({
        message: "One or more products were not found",
      });
    }

    if (products.some((product) => product.status === "active")) {
      return res.status(409).json({
        message: "Active products must be deactivated before deletion",
      });
    }

    const result = await Product.deleteMany({ _id: { $in: ids } });

    return res.status(200).json({
      message: "Products deleted successfully",
      data: {
        deletedCount: result.deletedCount,
      },
    });
  } catch (error) {
    error.message = "Could not delete products";
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
  createProductsBulk,
  updateProductsBulk,
  deleteProductsBulk,
  getProducts,
  getProductById,
  updateProduct,
  deactivateProduct,
  deleteProduct,
};
