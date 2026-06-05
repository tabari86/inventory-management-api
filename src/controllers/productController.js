const Product = require("../models/Product");

const createProduct = async (req, res) => {
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
    return res.status(500).json({
      message: "Could not create product",
    });
  }
};

const getProducts = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });

    return res.status(200).json({
      message: "Products retrieved successfully",
      data: products,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not retrieve products",
    });
  }
};

module.exports = {
  createProduct,
  getProducts,
};