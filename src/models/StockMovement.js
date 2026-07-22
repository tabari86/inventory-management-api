const mongoose = require("mongoose");

const productSnapshotSchema = new mongoose.Schema(
  {
    sku: { type: String, trim: true, maxlength: 64 },
    name: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false }
);

const warehouseSnapshotSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, maxlength: 64 },
    name: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false }
);

const stockMovementSchema = new mongoose.Schema(
  {
    stockId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stock",
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
    },
    type: {
      type: String,
      required: true,
      enum: ["GOODS_RECEIPT", "GOODS_ISSUE"],
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    reference: {
      type: String,
      trim: true,
    },
    reason: {
      type: String,
      trim: true,
    },
    quantityBefore: {
      type: Number,
      min: 0,
    },
    quantityAfter: {
      type: Number,
      min: 0,
    },
    aggregateVersion: {
      type: Number,
      min: 1,
      validate: Number.isInteger,
    },
    productSnapshot: {
      type: productSnapshotSchema,
      default: undefined,
    },
    warehouseSnapshot: {
      type: warehouseSnapshotSchema,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("StockMovement", stockMovementSchema);
