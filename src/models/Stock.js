const mongoose = require("mongoose");
const { indexesForCollection } = require("../config/apiReadIndexes");

const stockSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
      validate: Number.isInteger,
    },
    productLifecycleStatus: {
      type: String,
      required: true,
      enum: ["active", "inactive", "archived"],
      default: "active",
    },
    warehouseLifecycleStatus: {
      type: String,
      required: true,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

stockSchema.index(
  { productId: 1, warehouseId: 1 },
  { unique: true }
);

for (const { key, name } of indexesForCollection("stocks")) {
  stockSchema.index(key, { name });
}

module.exports = mongoose.model("Stock", stockSchema);
