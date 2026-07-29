const mongoose = require("mongoose");
const { indexesForCollection } = require("../config/apiReadIndexes");

const productSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 64,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    unit: {
      type: String,
      required: true,
      enum: ["piece", "kg", "liter", "meter"],
      default: "piece",
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
    deactivatedAt: Date,
    deactivatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    deactivationReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    archivedAt: Date,
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    archiveReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

for (const { key, name } of indexesForCollection("products")) {
  productSchema.index(key, { name });
}

module.exports = mongoose.model("Product", productSchema);
