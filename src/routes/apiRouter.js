const express = require("express");

const authRoutes = require("./authRoutes");
const goodsIssueRoutes = require("./goodsIssueRoutes");
const goodsReceiptRoutes = require("./goodsReceiptRoutes");
const productRoutes = require("./productRoutes");
const stockMovementRoutes = require("./stockMovementRoutes");
const stockRoutes = require("./stockRoutes");
const userRoutes = require("./userRoutes");
const warehouseRoutes = require("./warehouseRoutes");
const {
  createRouteMountContext,
} = require("../middleware/httpLogger");

const apiRouter = express.Router();

const mountRouter = (mountPath, router) =>
  apiRouter.use(
    mountPath,
    createRouteMountContext(mountPath),
    router
  );

mountRouter("/auth", authRoutes);
mountRouter("/users", userRoutes);
mountRouter("/products", productRoutes);
mountRouter("/warehouses", warehouseRoutes);
mountRouter("/stocks", stockRoutes);
mountRouter("/stock-movements", stockMovementRoutes);
mountRouter("/goods-receipts", goodsReceiptRoutes);
mountRouter("/goods-issues", goodsIssueRoutes);

module.exports = apiRouter;
