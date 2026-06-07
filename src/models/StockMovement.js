const mongoose = require("mongoose");

const stockMovementSchema = new mongoose.Schema(
  {
    stockId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stock",
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "GOODS_RECEIPT",
        "GOODS_ISSUE",
        "ADJUSTMENT",
        "TRANSFER_IN",
        "TRANSFER_OUT",
      ],
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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("StockMovement", stockMovementSchema);