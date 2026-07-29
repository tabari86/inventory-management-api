const express = require("express");

const authRoutes = require("./authRoutes");
const goodsIssueRoutes = require("./goodsIssueRoutes");
const goodsReceiptRoutes = require("./goodsReceiptRoutes");
const productRoutes = require("./productRoutes");
const stockMovementRoutes = require("./stockMovementRoutes");
const stockRoutes = require("./stockRoutes");
const userRoutes = require("./userRoutes");
const warehouseRoutes = require("./warehouseRoutes");

const apiRouter = express.Router();

apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", userRoutes);
apiRouter.use("/products", productRoutes);
apiRouter.use("/warehouses", warehouseRoutes);
apiRouter.use("/stocks", stockRoutes);
apiRouter.use("/stock-movements", stockMovementRoutes);
apiRouter.use("/goods-receipts", goodsReceiptRoutes);
apiRouter.use("/goods-issues", goodsIssueRoutes);

module.exports = apiRouter;
