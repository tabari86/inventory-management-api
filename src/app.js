const express = require("express");
const swaggerUi = require("swagger-ui-express");

const swaggerSpec = require("./config/swagger");
const errorHandler = require("./middleware/errorHandler");

const productRoutes = require("./routes/productRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");
const stockRoutes = require("./routes/stockRoutes");
const stockMovementRoutes = require("./routes/stockMovementRoutes");
const goodsReceiptRoutes = require("./routes/goodsReceiptRoutes");
const goodsIssueRoutes = require("./routes/goodsIssueRoutes");
const authRoutes = require("./routes/authRoutes");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Inventory Management API is running",
  });
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/stocks", stockRoutes);
app.use("/api/stock-movements", stockMovementRoutes);
app.use("/api/goods-receipts", goodsReceiptRoutes);
app.use("/api/goods-issues", goodsIssueRoutes);

app.use(errorHandler);

module.exports = app;